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
  /** Operation, lowercased: "create"/"created", "update"/"updated", "delete", "merge", "void", "emptied". */
  operation: string;
  /** When QuickBooks recorded the change (ISO 8601). */
  occurredAt: string;
  /** Which wire format this event arrived in. */
  wireFormat: 'legacy' | 'cloudevents';
}

export type PayloadFormat = 'legacy' | 'cloudevents' | 'unknown';
