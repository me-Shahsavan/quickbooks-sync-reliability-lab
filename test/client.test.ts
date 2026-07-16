import { test } from 'node:test';
import assert from 'node:assert/strict';

import { QboClient, QboApiError } from '../src/qbo/client.js';

/** Build a client whose fetch is a scripted stub; records every URL it was called with. */
function stubbedClient(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>) {
  const urls: string[] = [];
  let call = 0;
  const fetchImpl = (async (input: string | URL | Request) => {
    urls.push(String(input));
    const scripted = responses[Math.min(call, responses.length - 1)]!;
    call += 1;
    return new Response(scripted.body !== undefined ? JSON.stringify(scripted.body) : '', {
      status: scripted.status,
      headers: scripted.headers,
    });
  }) as typeof fetch;

  const client = new QboClient({
    accessToken: 'test-token',
    realmId: '1234567890123456',
    throttleDelayMs: 1, // keep throttle retries instant in tests
    fetchImpl,
  });
  return { client, urls, calls: () => call };
}

test('every write carries a requestid — the idempotency key that prevents duplicate creates', async () => {
  const { client, urls } = stubbedClient([{ status: 200, body: { Invoice: { Id: '145' } } }]);
  await client.write('invoice', { Line: [] });
  assert.match(urls[0]!, /[?&]requestid=[0-9a-f-]{36}/i);
});

test('a caller-provided requestid is used verbatim (cross-process retry safety)', async () => {
  const { client, urls } = stubbedClient([{ status: 200, body: {} }]);
  await client.write('invoice', { Line: [] }, { requestId: 'op-8842-attempt' });
  assert.match(urls[0]!, /[?&]requestid=op-8842-attempt/);
});

test('429 is retried and eventually succeeds', async () => {
  const { client, calls } = stubbedClient([
    { status: 429, body: { Fault: { type: 'Throttle' } } },
    { status: 429, body: { Fault: { type: 'Throttle' } } },
    { status: 200, body: { QueryResponse: {} } },
  ]);
  const result = await client.query('SELECT * FROM Invoice');
  assert.deepEqual(result, { QueryResponse: {} });
  assert.equal(calls(), 3);
});

test('Retry-After header is parsed onto the error for throttle-aware waits', async () => {
  // Use a non-retryable status carrying the header so the thrown error can be
  // inspected without waiting out the 429 retry loop.
  const { client } = stubbedClient([{ status: 400, headers: { 'retry-after': '2' }, body: { Fault: {} } }]);
  await assert.rejects(client.read('invoice', '145'), (error: unknown) => {
    assert.ok(error instanceof QboApiError);
    assert.equal(error.retryAfterMs, 2000);
    return true;
  });
});

test('4xx business failures are NOT retried — a blind retry is how duplicates are born', async () => {
  const { client, calls } = stubbedClient([
    { status: 400, body: { Fault: { Error: [{ code: '6240', Message: 'Duplicate Name Exists Error' }] } } },
  ]);
  await assert.rejects(client.write('customer', { DisplayName: 'Acme' }), (error: unknown) => {
    assert.ok(error instanceof QboApiError);
    assert.equal(error.status, 400);
    return true;
  });
  assert.equal(calls(), 1);
});

test('5xx transient errors are retried', async () => {
  const { client, calls } = stubbedClient([
    { status: 503 },
    { status: 200, body: { Invoice: { Id: '145' } } },
  ]);
  // 5xx uses jittered backoff (attempt 0 → ≤500ms), acceptable in a test.
  const result = await client.read('invoice', '145');
  assert.deepEqual(result, { Invoice: { Id: '145' } });
  assert.equal(calls(), 2);
});
