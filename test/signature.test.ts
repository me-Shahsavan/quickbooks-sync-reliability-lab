import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { verifyIntuitSignature } from '../src/webhooks/verify-signature.js';

const VERIFIER_TOKEN = 'test-verifier-token';

function sign(rawBody: string, token = VERIFIER_TOKEN): string {
  return createHmac('sha256', token).update(rawBody).digest('base64');
}

test('accepts a correctly signed raw body', () => {
  const rawBody = '{"eventNotifications":[]}';
  assert.equal(verifyIntuitSignature(rawBody, sign(rawBody), VERIFIER_TOKEN), true);
});

test('rejects a body signed with a different verifier token', () => {
  const rawBody = '{"eventNotifications":[]}';
  assert.equal(verifyIntuitSignature(rawBody, sign(rawBody, 'wrong-token'), VERIFIER_TOKEN), false);
});

test('rejects when the body was altered after signing', () => {
  const signature = sign('{"eventNotifications":[]}');
  assert.equal(verifyIntuitSignature('{"eventNotifications":[{}]}', signature, VERIFIER_TOKEN), false);
});

test('rejects missing signature header or missing token', () => {
  const rawBody = '{}';
  assert.equal(verifyIntuitSignature(rawBody, undefined, VERIFIER_TOKEN), false);
  assert.equal(verifyIntuitSignature(rawBody, sign(rawBody), ''), false);
});

test('signature is over RAW bytes — re-serialized JSON with different key order fails', () => {
  // The classic bug: a framework parses the body, you later JSON.stringify it
  // and sign/verify that. Key order or whitespace changes break the digest.
  const rawBody = '{"a": 1, "b": 2}';
  const reserialized = JSON.stringify(JSON.parse(rawBody)); // '{"a":1,"b":2}'
  assert.notEqual(rawBody, reserialized);
  assert.equal(verifyIntuitSignature(reserialized, sign(rawBody), VERIFIER_TOKEN), false);
  assert.equal(verifyIntuitSignature(rawBody, sign(rawBody), VERIFIER_TOKEN), true);
});
