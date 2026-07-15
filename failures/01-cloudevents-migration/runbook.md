# Runbook — migrating QuickBooks webhooks to CloudEvents

**Audience:** the engineer on rotation who owns the webhook consumer.
**Goal:** flip the payload format with zero dropped events and a tested rollback.
**Deadline context:** legacy format ends July 31, 2026; after that, this runbook's
rollback path (flipping back to legacy) may no longer exist — migrate before the
deadline while both formats are available, not after.

## Pre-checks (before touching anything)

- [ ] Confirm which format you receive **today**: log `detectFormat(body)` for 24h of
      traffic. If `cloudevents` already appears, the toggle was flipped without a
      migration — go straight to step 3.
- [ ] Confirm signature validation reads the **raw request body** (not re-parsed JSON).
      HMAC is unchanged by this migration, but raw-body handling is the most common
      pre-existing bug this migration exposes.
- [ ] Confirm you have an event-volume metric with at least 7 days of baseline.
      If not, add it first — without a baseline you cannot verify the cutover.
- [ ] Locate the format toggle: Intuit Developer portal → your app → Webhooks.

## Step 1 — Deploy the dual-format consumer (no behavior change yet)

Deploy a normalizer that accepts **both** shapes and treats unknown shapes as an alarm
(reference implementation: `src/webhooks/normalize.ts`). Key properties:

- legacy payloads → normalized events (unchanged behavior)
- CloudEvents payloads → the **same** normalized events
- anything else → `unknownFormat` counter + alert, still ack 200 only if signature-valid

**Verify:** unit tests pass for both recorded fixtures; production traffic unchanged.

## Step 2 — Rehearse in sandbox

1. In a sandbox app, flip the format toggle to CloudEvents.
2. Trigger a change (create/update a customer in the sandbox company).
3. Confirm: delivery arrives, signature validates, normalized event is identical to
   what the legacy format produced for the same change.
4. Capture the real payload and commit it as a fixture (replace/verify the recorded one).

## Step 3 — Flip production

1. Flip the toggle during a low-traffic window with the on-call watching dashboards.
2. Watch for 30 minutes:
   - `unknownFormat` counter stays at **0**
   - event volume tracks the 7-day baseline for that hour
   - signature-rejection counter stays at baseline
3. Run one canary round-trip: touch the canary entity, assert the event arrives
   end-to-end within the freshness SLO.

## Step 4 — Post-cutover

- [ ] Keep the legacy parser in place (it costs nothing and guards against surprises)
      but add a log line if it ever matches again after cutover.
- [ ] Schedule a CDC reconciliation sweep covering the cutover window to catch any
      events dropped during the flip. Anything CDC finds that webhooks missed is your
      measured migration gap — record it in the postmortem, even if zero.
- [ ] Update the fixture in this repo if the captured payload differs.

## Rollback criteria

Flip the toggle back to legacy (available only until July 31, 2026) if any of:

- `unknownFormat` counter is climbing after cutover (payload shape differs from the
  one you rehearsed — capture it, fix the parser, retry)
- event volume drops >50% below baseline for 2 consecutive hours with the business active
- signature rejections spike (indicates a raw-body handling regression, not a format issue —
  fix forward if possible, since rolling back won't change signature behavior)

After rollback: run a CDC sweep over the affected window before retrying. The events
that arrived while broken are gone from the webhook channel — only reconciliation
recovers them.
