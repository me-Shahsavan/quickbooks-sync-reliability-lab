import type { ChangeEvent, ParseResult } from './types.js';
import { canonicalizeOperation } from './operations.js';

/**
 * Parser for the LEGACY webhook envelope:
 *
 * {
 *   "eventNotifications": [{
 *     "realmId": "1234567890123456",
 *     "dataChangeEvent": {
 *       "entities": [{ "name": "Invoice", "id": "145", "operation": "Update", "lastUpdated": "..." }]
 *     }
 *   }]
 * }
 *
 * The exported `parseLegacyNaive` below is written the way most integrations
 * in the wild wrote it: optional chaining everywhere, no format check, no
 * accounting for what it skips. That defensive style is exactly what makes
 * the CloudEvents migration dangerous — feed it a CloudEvents payload and it
 * returns ZERO events without throwing. The endpoint still answers 200 OK,
 * so nothing retries, nothing alerts, and the events are gone.
 * See failures/01-cloudevents-migration.
 *
 * `parseLegacy` is the corrected version: same extraction, but everything it
 * cannot normalize is COUNTED as rejected instead of silently skipped.
 */

/** The trap, preserved verbatim as the repro for chapter 01. Do not use. */
export function parseLegacyNaive(body: unknown): ChangeEvent[] {
  return parseLegacy(body).events;
}

export function parseLegacy(body: unknown): ParseResult {
  const notifications = (body as any)?.eventNotifications;
  if (!Array.isArray(notifications)) return { events: [], rejected: 0 };

  const events: ChangeEvent[] = [];
  let rejected = 0;

  for (const notification of notifications) {
    const realmId = String(notification?.realmId ?? '');
    const entities = notification?.dataChangeEvent?.entities;
    if (!realmId || !Array.isArray(entities)) {
      rejected += 1;
      continue;
    }

    for (const entity of entities) {
      const operation = canonicalizeOperation(entity?.operation);
      if (!entity?.name || !entity?.id || operation === null) {
        rejected += 1;
        continue;
      }
      events.push({
        realmId,
        entity: String(entity.name).toLowerCase(),
        entityId: String(entity.id),
        operation,
        occurredAt: String(entity.lastUpdated ?? ''),
        wireFormat: 'legacy',
      });
    }
  }
  return { events, rejected };
}
