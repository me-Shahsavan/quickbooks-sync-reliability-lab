import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseLegacy } from '../src/webhooks/parse-legacy.js';
import { parseCloudEvents } from '../src/webhooks/parse-cloudevents.js';
import { detectFormat, normalizeAny } from '../src/webhooks/normalize.js';

const legacyFixture = JSON.parse(
  readFileSync(new URL('../failures/01-cloudevents-migration/fixtures/legacy-invoice-update.json', import.meta.url), 'utf8'),
);
const cloudEventsFixture = JSON.parse(
  readFileSync(new URL('../failures/01-cloudevents-migration/fixtures/cloudevents-invoice-update.json', import.meta.url), 'utf8'),
);

test('legacy parser extracts events from a legacy payload', () => {
  const events = parseLegacy(legacyFixture);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    realmId: '9341454759827300',
    entity: 'invoice',
    entityId: '145',
    operation: 'update',
    occurredAt: '2026-07-01T16:24:51.000Z',
    wireFormat: 'legacy',
  });
});

test('cloudevents parser extracts events from a CloudEvents payload', () => {
  const events = parseCloudEvents(cloudEventsFixture);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    realmId: '9341454759827300',
    entity: 'invoice',
    entityId: '145',
    operation: 'updated',
    occurredAt: '2026-07-01T16:24:51.179Z',
    wireFormat: 'cloudevents',
  });
});

test('THE FAILURE MODE: legacy parser silently drops a CloudEvents payload', () => {
  // No exception. No log. Zero events. The endpoint that wraps this parser
  // still returns 200 OK, so Intuit considers the notification delivered and
  // never retries. This is how an integration loses weeks of changes after
  // the July 31, 2026 format cutover. See failures/01-cloudevents-migration.
  const events = parseLegacy(cloudEventsFixture);
  assert.equal(events.length, 0);
});

test('format detection distinguishes legacy, cloudevents, and unknown', () => {
  assert.equal(detectFormat(legacyFixture), 'legacy');
  assert.equal(detectFormat(cloudEventsFixture), 'cloudevents');
  assert.equal(detectFormat({ something: 'else' }), 'unknown');
  assert.equal(detectFormat(undefined), 'unknown');
});

test('dual-format normalizer produces identical normalized events for both formats', () => {
  const legacy = normalizeAny(legacyFixture);
  const cloud = normalizeAny(cloudEventsFixture);

  assert.equal(legacy.format, 'legacy');
  assert.equal(cloud.format, 'cloudevents');
  assert.equal(legacy.events.length, cloud.events.length);

  // Same realm, entity, and entity ID from either wire format — the consumer
  // downstream of the normalizer never needs to know which format arrived.
  for (let i = 0; i < legacy.events.length; i++) {
    assert.equal(legacy.events[i]!.realmId, cloud.events[i]!.realmId);
    assert.equal(legacy.events[i]!.entity, cloud.events[i]!.entity);
    assert.equal(legacy.events[i]!.entityId, cloud.events[i]!.entityId);
  }
});

test('normalizer surfaces unknown formats instead of swallowing them', () => {
  const result = normalizeAny({ v2EventPayload: [] });
  assert.equal(result.format, 'unknown');
  assert.equal(result.events.length, 0);
});
