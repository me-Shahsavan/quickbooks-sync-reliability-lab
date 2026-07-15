import type { ChangeEvent, PayloadFormat } from './types.js';
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

export interface NormalizeResult {
  format: PayloadFormat;
  events: ChangeEvent[];
}

/**
 * Dual-format normalizer — the safe shape to run through a format migration.
 * Accepts either format, returns normalized events, and surfaces `unknown`
 * instead of swallowing it.
 */
export function normalizeAny(body: unknown): NormalizeResult {
  const format = detectFormat(body);
  switch (format) {
    case 'legacy':
      return { format, events: parseLegacy(body) };
    case 'cloudevents':
      return { format, events: parseCloudEvents(body) };
    default:
      return { format, events: [] };
  }
}
