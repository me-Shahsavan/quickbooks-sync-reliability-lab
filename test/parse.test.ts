import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseLegacy, parseLegacyNaive } from '../src/webhooks/parse-legacy.js';
import { parseCloudEvents } from '../src/webhooks/parse-cloudevents.js';
import { detectFormat, normalizeAny } from '../src/webhooks/normalize.js';

const legacyFixture = JSON.parse(
  readFileSync(new URL('../failures/01-cloudevents-migration/fixtures/legacy-invoice-update.json', import.meta.url), 'utf8'),
);
const cloudEventsFixture = JSON.parse(
  readFileSync(new URL('../failures/01-cloudevents-migration/fixtures/cloudevents-invoice-update.json', import.meta.url), 'utf8'),
);

test('legacy parser extracts events from a legacy payload', () => {
  const { events, rejected } = parseLegacy(legacyFixture);
  assert.equal(events.length, 2);
  assert.equal(rejected, 0);
  assert.deepEqual(events[0], {
    realmId: '1234567890123456',
    entity: 'invoice',
    entityId: '145',
    operation: 'update',
    occurredAt: '2026-07-01T16:24:51.000Z',
    wireFormat: 'legacy',
  });
});

test('cloudevents parser extracts events from a CloudEvents payload', () => {
  const { events, rejected } = parseCloudEvents(cloudEventsFixture);
  assert.equal(events.length, 2);
  assert.equal(rejected, 0);
  assert.deepEqual(events[0], {
    realmId: '1234567890123456',
    entity: 'invoice',
    entityId: '145',
    operation: 'update', // canonical — wire said "updated"
    occurredAt: '2026-07-01T16:24:51.179Z',
    wireFormat: 'cloudevents',
  });
});

test('THE FAILURE MODE: naive legacy parser silently drops a CloudEvents payload', () => {
  // No exception. No log. Zero events. The endpoint that wraps this parser
  // still returns 200 OK, so Intuit considers the notification delivered and
  // never retries. This is how an integration loses weeks of changes after
  // the July 31, 2026 format cutover. See failures/01-cloudevents-migration.
  const events = parseLegacyNaive(cloudEventsFixture);
  assert.equal(events.length, 0);
});

test('format detection distinguishes legacy, cloudevents, and unknown', () => {
  assert.equal(detectFormat(legacyFixture), 'legacy');
  assert.equal(detectFormat(cloudEventsFixture), 'cloudevents');
  assert.equal(detectFormat({ something: 'else' }), 'unknown');
  assert.equal(detectFormat(undefined), 'unknown');
});

test('both formats normalize to IDENTICAL events (up to timestamp precision and wire tag)', () => {
  const legacy = normalizeAny(legacyFixture);
  const cloud = normalizeAny(cloudEventsFixture);

  assert.equal(legacy.format, 'legacy');
  assert.equal(cloud.format, 'cloudevents');
  assert.equal(legacy.events.length, cloud.events.length);

  // The consumer downstream of the normalizer never needs to know which
  // format arrived: realm, entity, entity ID, AND canonical operation match.
  for (let i = 0; i < legacy.events.length; i++) {
    const a = legacy.events[i]!;
    const b = cloud.events[i]!;
    assert.deepEqual(
      { realmId: a.realmId, entity: a.entity, entityId: a.entityId, operation: a.operation },
      { realmId: b.realmId, entity: b.entity, entityId: b.entityId, operation: b.operation },
    );
  }
});

test('normalizer surfaces unknown formats instead of swallowing them', () => {
  const result = normalizeAny({ v2EventPayload: [] });
  assert.equal(result.format, 'unknown');
  assert.equal(result.events.length, 0);
});

// --- P5: nothing inside a recognized payload may be dropped silently ---

test('cloudevents: an unrecognized type string is REJECTED and counted, not skipped', () => {
  const payload = [
    { ...cloudEventsFixture[0], type: 'qbo.invoice.reconciled.v1' }, // unknown operation
    cloudEventsFixture[1],
  ];
  const { events, rejected } = parseCloudEvents(payload);
  assert.equal(events.length, 1);
  assert.equal(rejected, 1);
});

test('cloudevents: a completely foreign type shape is rejected and counted', () => {
  const payload = [{ ...cloudEventsFixture[0], type: 'qbo.invoice.updated' }]; // no .v1 suffix
  const { events, rejected } = parseCloudEvents(payload);
  assert.equal(events.length, 0);
  assert.equal(rejected, 1);
});

test('cloudevents: missing entity or realm IDs are rejected, not processed as empty strings', () => {
  const missingEntityId = [{ ...cloudEventsFixture[0], intuitentityid: undefined }];
  const missingRealm = [{ ...cloudEventsFixture[0], intuitaccountid: undefined }];
  assert.deepEqual(
    [parseCloudEvents(missingEntityId).rejected, parseCloudEvents(missingRealm).rejected],
    [1, 1],
  );
  assert.equal(parseCloudEvents(missingEntityId).events.length, 0);
  assert.equal(parseCloudEvents(missingRealm).events.length, 0);
});

test('legacy: malformed entities and notifications are rejected and counted', () => {
  const payload = {
    eventNotifications: [
      {
        realmId: '1234567890123456',
        dataChangeEvent: {
          entities: [
            { name: 'Invoice', id: '145', operation: 'Update', lastUpdated: '2026-07-01T00:00:00Z' },
            { name: 'Invoice', operation: 'Update' }, // missing id
            { name: 'Invoice', id: '146', operation: 'Reconciled' }, // unknown operation
          ],
        },
      },
      { dataChangeEvent: { entities: [] } }, // missing realmId
    ],
  };
  const { events, rejected } = parseLegacy(payload);
  assert.equal(events.length, 1);
  assert.equal(rejected, 3);
});

test('normalizeAny propagates the rejected count as its own alarm signal', () => {
  const mixed = [cloudEventsFixture[0], { ...cloudEventsFixture[1], type: 'qbo.customer.migrated.v2' }];
  const result = normalizeAny(mixed);
  assert.equal(result.format, 'cloudevents');
  assert.equal(result.events.length, 1);
  assert.equal(result.rejected, 1);
});
