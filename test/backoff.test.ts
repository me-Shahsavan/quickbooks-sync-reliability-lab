import { test } from 'node:test';
import assert from 'node:assert/strict';

import { backoffDelayMs, withRetries } from '../src/lib/backoff.js';

test('backoff delay stays within [0, base * 2^attempt] and respects the cap', () => {
  for (let attempt = 0; attempt < 12; attempt++) {
    for (let i = 0; i < 50; i++) {
      const delay = backoffDelayMs(attempt, 500, 60_000);
      assert.ok(delay >= 0);
      assert.ok(delay <= Math.min(60_000, 500 * 2 ** attempt));
    }
  }
});

test('withRetries succeeds after transient failures', async () => {
  let calls = 0;
  const result = await withRetries(
    async () => {
      calls += 1;
      if (calls < 3) throw new Error('transient');
      return 'ok';
    },
    { delayMs: () => 0 },
  );
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('withRetries does NOT retry when isRetryable says no', async () => {
  let calls = 0;
  await assert.rejects(
    withRetries(
      async () => {
        calls += 1;
        throw new Error('validation failure — a blind retry could create bad data');
      },
      { isRetryable: () => false, delayMs: () => 0 },
    ),
  );
  assert.equal(calls, 1);
});

test('withRetries gives up after maxAttempts and rethrows the last error', async () => {
  let calls = 0;
  await assert.rejects(
    withRetries(
      async () => {
        calls += 1;
        throw new Error(`attempt ${calls}`);
      },
      { maxAttempts: 4, delayMs: () => 0 },
    ),
    /attempt 4/,
  );
  assert.equal(calls, 4);
});

test('withRetries consults the delayMs override with the failing error', async () => {
  const seen: unknown[] = [];
  let calls = 0;
  await withRetries(
    async () => {
      calls += 1;
      if (calls === 1) throw new Error('throttle');
      return 'ok';
    },
    {
      delayMs: (_attempt, error) => {
        seen.push(error);
        return 0;
      },
    },
  );
  assert.equal(seen.length, 1);
  assert.match(String(seen[0]), /throttle/);
});
