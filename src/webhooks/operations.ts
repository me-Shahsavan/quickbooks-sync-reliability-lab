import type { CanonicalOperation } from './types.js';

/**
 * Map either wire format's operation vocabulary to the canonical one.
 * Legacy: Create / Update / Delete / Merge / Void / Emptied
 * CloudEvents (from the `type` string): created / updated / deleted / merged / voided / emptied
 *
 * Returns null for anything unrecognized. Callers must treat null as a
 * REJECTED event (counted + alarmed), not as a default: an operation we
 * don't know is a contract change, and pretending it was an "update" would
 * corrupt downstream state silently.
 */
const OPERATION_MAP: Record<string, CanonicalOperation> = {
  create: 'create',
  created: 'create',
  update: 'update',
  updated: 'update',
  delete: 'delete',
  deleted: 'delete',
  merge: 'merge',
  merged: 'merge',
  void: 'void',
  voided: 'void',
  emptied: 'emptied',
};

export function canonicalizeOperation(raw: unknown): CanonicalOperation | null {
  if (typeof raw !== 'string') return null;
  return OPERATION_MAP[raw.toLowerCase()] ?? null;
}
