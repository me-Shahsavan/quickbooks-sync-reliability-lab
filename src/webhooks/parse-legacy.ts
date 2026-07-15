import type { ChangeEvent } from './types.js';

/**
 * Parser for the LEGACY webhook envelope:
 *
 * {
 *   "eventNotifications": [{
 *     "realmId": "310687",
 *     "dataChangeEvent": {
 *       "entities": [{ "name": "Invoice", "id": "145", "operation": "Update", "lastUpdated": "..." }]
 *     }
 *   }]
 * }
 *
 * This is written the way most integrations in the wild wrote it: optional
 * chaining everywhere, no format check. That defensive style is exactly what
 * makes the CloudEvents migration dangerous — feed this parser a CloudEvents
 * payload and it returns ZERO events without throwing. The endpoint still
 * answers 200 OK, so nothing retries, nothing alerts, and the events are gone.
 * See failures/01-cloudevents-migration.
 */
export function parseLegacy(body: unknown): ChangeEvent[] {
  const notifications = (body as any)?.eventNotifications;
  if (!Array.isArray(notifications)) return [];

  const events: ChangeEvent[] = [];
  for (const notification of notifications) {
    const realmId = String(notification?.realmId ?? '');
    const entities = notification?.dataChangeEvent?.entities;
    if (!realmId || !Array.isArray(entities)) continue;

    for (const entity of entities) {
      if (!entity?.name || !entity?.id) continue;
      events.push({
        realmId,
        entity: String(entity.name).toLowerCase(),
        entityId: String(entity.id),
        operation: String(entity.operation ?? '').toLowerCase(),
        occurredAt: String(entity.lastUpdated ?? ''),
        wireFormat: 'legacy',
      });
    }
  }
  return events;
}
