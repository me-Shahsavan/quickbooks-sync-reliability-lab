import type { ChangeEvent } from './types.js';

/**
 * Parser for the CLOUDEVENTS webhook format (CNCF CloudEvents 1.0), which is
 * the only format Intuit delivers after July 31, 2026:
 *
 * [
 *   {
 *     "specversion": "1.0",
 *     "id": "88cd52aa-33b6-4351-9aa4-47572edbd068",
 *     "source": "intuit.dsn...",
 *     "type": "qbo.customer.created.v1",
 *     "datacontenttype": "application/json",
 *     "time": "2025-09-10T21:31:25.179Z",
 *     "intuitentityid": "1234",
 *     "intuitaccountid": "310687",
 *     "data": {}
 *   }
 * ]
 *
 * Differences that break naive migrations:
 *  - top level is an ARRAY, not an object with `eventNotifications`
 *  - realm ID lives in `intuitaccountid` per event (one delivery can span realms)
 *  - entity + operation are encoded in the `type` string ("qbo.<entity>.<operation>.v<n>")
 *  - still no field data: `data` is empty; you follow up with a read or CDC call
 */

const TYPE_PATTERN = /^qbo\.([a-z]+)\.([a-z]+)\.v\d+$/i;

export function parseCloudEvents(body: unknown): ChangeEvent[] {
  if (!Array.isArray(body)) return [];

  const events: ChangeEvent[] = [];
  for (const event of body) {
    if (event?.specversion == null || typeof event?.type !== 'string') continue;
    const match = TYPE_PATTERN.exec(event.type);
    if (!match) continue;

    events.push({
      realmId: String(event.intuitaccountid ?? ''),
      entity: match[1]!.toLowerCase(),
      entityId: String(event.intuitentityid ?? ''),
      operation: match[2]!.toLowerCase(),
      occurredAt: String(event.time ?? ''),
      wireFormat: 'cloudevents',
    });
  }
  return events;
}
