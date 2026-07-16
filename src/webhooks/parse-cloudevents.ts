import type { ChangeEvent, ParseResult } from './types.js';
import { canonicalizeOperation } from './operations.js';

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
 *     "intuitaccountid": "1234567890123456",
 *     "data": {}
 *   }
 * ]
 *
 * Differences that break naive migrations:
 *  - top level is an ARRAY, not an object with `eventNotifications`
 *  - realm ID lives in `intuitaccountid` per event (one delivery can span realms)
 *  - entity + operation are encoded in the `type` string ("qbo.<entity>.<operation>.v<n>")
 *  - still no field data: `data` is empty; you follow up with a read or CDC call
 *
 * Anything in the array that cannot be normalized — unknown `type` shape,
 * unknown operation, missing entity/realm IDs — is counted in `rejected`,
 * never silently skipped (principle P5).
 */

const TYPE_PATTERN = /^qbo\.([a-z]+)\.([a-z]+)\.v\d+$/i;

export function parseCloudEvents(body: unknown): ParseResult {
  if (!Array.isArray(body)) return { events: [], rejected: 0 };

  const events: ChangeEvent[] = [];
  let rejected = 0;

  for (const event of body) {
    const match = typeof event?.type === 'string' ? TYPE_PATTERN.exec(event.type) : null;
    const operation = match ? canonicalizeOperation(match[2]) : null;
    const entityId = event?.intuitentityid != null ? String(event.intuitentityid) : '';
    const realmId = event?.intuitaccountid != null ? String(event.intuitaccountid) : '';

    if (event?.specversion == null || !match || operation === null || !entityId || !realmId) {
      rejected += 1;
      continue;
    }

    events.push({
      realmId,
      entity: match[1]!.toLowerCase(),
      entityId,
      operation,
      occurredAt: String(event.time ?? ''),
      wireFormat: 'cloudevents',
    });
  }
  return { events, rejected };
}
