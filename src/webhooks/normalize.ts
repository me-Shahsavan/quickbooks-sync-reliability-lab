import type { ParseResult, PayloadFormat } from './types.js';
import { parseLegacy } from './parse-legacy.js';
import { parseCloudEvents } from './parse-cloudevents.js';

/**
 * Detect which wire format a webhook body is in.
 *
 * 'unknown' matters as much as the other two: during a format migration the
 * correct behavior for an unrecognized payload is to COUNT IT AND ALARM,
 * never to silently return zero events (see failures/01-cloudevents-migration).
 */
export function detectFormat(body: unknown): PayloadFormat {
  if (Array.isArray(body) && body.length > 0 && (body[0] as any)?.specversion != null) {
    return 'cloudevents';
  }
  if (body != null && typeof body === 'object' && Array.isArray((body as any).eventNotifications)) {
    return 'legacy';
  }
  return 'unknown';
}

export interface NormalizeResult extends ParseResult {
  format: PayloadFormat;
}

/**
 * Dual-format normalizer — the safe shape to run through a format migration.
 * Accepts either format and returns one normalized event stream plus two
 * distinct alarm signals:
 *
 *  - format === 'unknown'  → the whole payload shape is unrecognized
 *  - rejected > 0          → the payload shape was recognized, but items
 *                            inside it could not be normalized (new operation,
 *                            missing IDs, changed type string, ...)
 *
 * Both mean the provider's contract moved under you. Alarm on both.
 */
export function normalizeAny(body: unknown): NormalizeResult {
  const format = detectFormat(body);
  switch (format) {
    case 'legacy':
      return { format, ...parseLegacy(body) };
    case 'cloudevents':
      return { format, ...parseCloudEvents(body) };
    default:
      return { format, events: [], rejected: 0 };
  }
}
