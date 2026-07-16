/**
 * One QuickBooks change event, normalized across payload formats.
 *
 * Both the legacy `eventNotifications` envelope and the CloudEvents format
 * (mandatory after July 31, 2026) carry the same information: which entity
 * changed, in which company (realm), and how. Neither format carries the
 * entity's field data — you always follow up with a read or CDC call.
 */
export interface ChangeEvent {
  /** QuickBooks company ID the change belongs to. */
  realmId: string;
  /** Entity type, lowercased: "invoice", "customer", "payment", ... */
  entity: string;
  /** ID of the changed entity within the realm. */
  entityId: string;
  /** Canonical operation — identical regardless of wire format. */
  operation: CanonicalOperation;
  /** When QuickBooks recorded the change (ISO 8601). */
  occurredAt: string;
  /** Which wire format this event arrived in. */
  wireFormat: 'legacy' | 'cloudevents';
}

export type PayloadFormat = 'legacy' | 'cloudevents' | 'unknown';

/**
 * The operations QuickBooks emits, in one canonical vocabulary. Legacy says
 * "Update", CloudEvents says "updated" — consumers should never have to know.
 */
export type CanonicalOperation = 'create' | 'update' | 'delete' | 'merge' | 'void' | 'emptied';

/**
 * What every parser returns: the events it understood, plus a COUNT of the
 * items it did not. Principle P5 (docs/rfc-001-trustworthy-sync.md): a parser
 * that quietly skips what it can't read converts contract changes into silent
 * data loss. Rejected items must be counted and alarmed, never swallowed —
 * including events with an operation this vocabulary doesn't know yet, since
 * an unknown operation is a contract change too.
 */
export interface ParseResult {
  events: ChangeEvent[];
  /** Items present in the payload that could not be normalized. Alarm at > 0. */
  rejected: number;
}
