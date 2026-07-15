# 01 — The CloudEvents migration: how your webhooks silently stop

> **TL;DR** — Intuit rebuilt its webhooks platform on the CNCF CloudEvents format. After
> **July 31, 2026**, apps still parsing the legacy `eventNotifications` envelope receive
> payloads they cannot read. The dangerous part: a defensively-written legacy parser
> doesn't crash — it returns **zero events and answers 200 OK**, so Intuit marks the
> notification delivered, nothing retries, nothing alerts, and changes are lost until
> someone notices at reconciliation.

| | |
|---|---|
| **Severity** | High — silent data loss (missed changes), not an outage |
| **Detection difficulty** | High — no errors anywhere; only absence of events |
| **Repro** | Offline, `npm test` (no sandbox needed) |
| **Fix cost** | Low — dual-format parser + one alarm counter |

## Context

- **Nov 12, 2025** — Intuit announces the webhooks platform rebuild: payloads move from
  the legacy `eventNotifications` envelope to [CloudEvents](https://cloudevents.io/)
  (CNCF spec). ([announcement](https://blogs.intuit.com/2025/11/12/upcoming-change-to-webhooks-payload-structure))
- **May 15, 2026** — original migration deadline, later **extended to July 31, 2026**.
- A toggle on the app's webhooks subscription page switches the delivery format.
- **HMAC validation did not change** — same `intuit-signature` header, same
  HMAC-SHA256 over the raw body with your verifier token. Only the payload shape moved.
- Intuit ships an official [CloudEvents sample app](https://github.com/IntuitDeveloper/SampleApp-Webhooks-Java-Cloudevents)
  (Java); this chapter is the equivalent lesson in ~100 lines of TypeScript.

## What actually breaks

The two formats disagree at every structural level:

| | Legacy | CloudEvents |
|---|---|---|
| Top level | object with `eventNotifications` array | **array** of event objects |
| Realm ID | `eventNotifications[].realmId` | `intuitaccountid` **per event** (one delivery can span realms) |
| Entity + operation | `entities[].name` + `entities[].operation` | encoded in the `type` string: `qbo.invoice.updated.v1` |
| Timestamp | `entities[].lastUpdated` | `time` |
| Field data | none — follow up with a read or CDC call | none — same rule, `data` is empty |

Most real-world webhook handlers were written defensively:

```ts
const notifications = body?.eventNotifications;
if (!Array.isArray(notifications)) return [];   // ← the trap
```

Feed that a CloudEvents array and it returns `[]` — no exception, no log line. The
HTTP endpoint wrapping it happily acks with 200, which tells Intuit the notification
was consumed. **The failure signature is pure absence**: sync keeps "working," the
books quietly drift, and the gap surfaces weeks later when someone reconciles.

This failure class isn't unique to Intuit — it's what any provider-driven payload
migration does to consumers that treat "can't parse" as "nothing to do."

## Reproduce it (offline, 30 seconds)

```bash
npm install
npm test
```

Watch for this test:

```
✔ THE FAILURE MODE: legacy parser silently drops a CloudEvents payload
```

It runs the recorded CloudEvents fixture through the legacy parser
([`src/webhooks/parse-legacy.ts`](../../src/webhooks/parse-legacy.ts)) and asserts the
poisonous outcome: **0 events, 0 errors**.

To see the migration-safe behavior, run the dual-format receiver and post both fixtures at it:

```bash
npm run receiver
# in another terminal:
curl -s -X POST localhost:3000/webhooks -H "content-type: application/json" \
  --data @failures/01-cloudevents-migration/fixtures/legacy-invoice-update.json
curl -s -X POST localhost:3000/webhooks -H "content-type: application/json" \
  --data @failures/01-cloudevents-migration/fixtures/cloudevents-invoice-update.json
```

Both produce identical normalized events. Post any *other* JSON shape and the receiver
raises an `[ALARM]` and increments an `unknownFormat` counter instead of swallowing it.

> Fixtures: the legacy payload follows Intuit's long-documented envelope; the CloudEvents
> payload follows the structure in Intuit's official sample app. Before relying on this
> in production, capture a real delivery from your own sandbox with the format toggle
> flipped and diff it against the fixture.

## Detection — how you'd catch this in production

The failure emits no errors, so detection must key on **absence and unknowns**:

1. **Unknown-format counter (leading indicator).** Any payload your parser can't
   classify increments a counter and pages at `> 0`. This catches the failure on the
   *first* delivery after the cutover, not weeks later. (~5 lines; see
   [`receiver.ts`](../../src/webhooks/receiver.ts).)
2. **Event-volume watchdog (trailing indicator).** Alert when webhook events processed
   per hour drops to zero while the business is active. Catches this failure *and*
   every other webhook-delivery gap.
3. **Canary reconciliation (ground truth).** On a schedule, make a tiny change to a
   designated canary entity in QuickBooks and assert the webhook for it arrives within
   the freshness SLO ([docs/slo.md](../../docs/slo.md)). This is the only signal that
   measures the pipeline end-to-end.

## Fix

Migration runbook with rollback criteria: **[runbook.md](./runbook.md)**
Simulated incident write-up (Google SRE format): **[postmortem.md](./postmortem.md)**

## The deeper lesson

QuickBooks webhooks are **best-effort and carry no data** in either format. A sync
architecture that treats them as the source of truth inherits every delivery gap as
silent divergence. The durable pattern — which this migration merely stress-tests — is:

> **Webhooks are a latency optimization. Reconciliation (CDC) is the source of truth.**

A change-data-capture sweep on a schedule bounds the damage of *any* webhook failure,
including this one, to one sweep interval. That pattern (and CDC's own sharp edge — the
30-day lookback window) gets its own chapter: see the [roadmap](../../README.md#roadmap).

## Sources

- [Intuit: Upcoming change to webhooks payload structure](https://blogs.intuit.com/2025/11/12/upcoming-change-to-webhooks-payload-structure) (Nov 12, 2025)
- [Intuit's official CloudEvents webhook sample app](https://github.com/IntuitDeveloper/SampleApp-Webhooks-Java-Cloudevents)
- [CNCF CloudEvents specification](https://cloudevents.io/)
- [Intuit: webhooks documentation](https://developer.intuit.com/app/developer/qbo/docs/develop/webhooks)
- Deadline extension to July 31, 2026 reported by third parties (e.g. [maesn](https://www.maesn.com/blog/quickbooks-webhooks-cloudevents)); verify current dates on the developer portal.
