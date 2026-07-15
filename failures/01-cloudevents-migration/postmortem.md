# Postmortem — 19 days of silently dropped webhook events after CloudEvents cutover

> **Note:** this is a *simulated* incident, written in the
> [Google SRE postmortem format](https://sre.google/workbook/postmortem-culture/) for a
> fictional SMB integration ("Acme Sync"). Every technical detail is real and
> reproducible from this chapter's fixtures and tests; the company, dates, and people
> are illustrative. It exists because the most useful artifact for preventing a failure
> is a blameless account of how it plays out.

## Summary

After the QuickBooks webhook payload format was switched to CloudEvents, Acme Sync's
webhook consumer — which parsed only the legacy `eventNotifications` envelope — returned
zero events per delivery while continuing to acknowledge every notification with 200 OK.
No errors were raised. For 19 days, changes made in QuickBooks did not propagate to the
CRM. The gap was discovered by a customer's bookkeeper during month-end reconciliation.

**Impact:** 100% of QuickBooks→CRM change propagation lost for 19 days across all
connected companies. 4,212 entity changes recovered by backfill; 37 required manual
review due to conflicting edits made in the CRM during the gap.

## Timeline (all times UTC)

- **Jul 08, 10:02** — Format toggle flipped to CloudEvents in the production app.
  Intent: get ahead of the July 31 deadline. No consumer change was deployed; the team
  believed the payload change was "additive."
- **Jul 08, 10:04** — First CloudEvents delivery arrives. Legacy parser finds no
  `eventNotifications` key, returns `[]`. Endpoint acks 200. **Incident begins.**
- **Jul 08–26** — Sync UI continues to show "healthy": the *outbound* (CRM→QuickBooks)
  direction works, and the webhook endpoint's uptime and 2xx-rate dashboards are green.
  No inbound events are processed. No alert exists on "events processed = 0."
- **Jul 27, 14:31** — Customer bookkeeper reports invoices edited in QuickBooks not
  matching the CRM during month-end close. Support escalates.
- **Jul 27, 16:05** — On-call inspects raw webhook payloads, sees the CloudEvents array
  shape, correlates with the Jul 08 toggle. **Root cause identified (94 min).**
- **Jul 27, 17:40** — Dual-format normalizer deployed. Inbound propagation resumes.
- **Jul 27–29** — CDC-based backfill sweeps the gap window. Because the gap (19 days)
  was inside CDC's 30-day lookback, the backfill was complete; a 12-day-later discovery
  would have required a full resync.

## Root cause

The webhook consumer treated "payload I cannot parse" as "payload containing nothing."
Defensive optional-chaining (`body?.eventNotifications ?? []`) converted a **format
contract change** into an **empty result**, and the surrounding endpoint converted the
empty result into a successful ack. Every layer behaved "safely"; the composition lost data.

Contributing causes:

1. **The toggle and the consumer were owned as one change but shipped as two.** The
   format flip is a one-click platform setting; the parser change is a deploy. Nothing
   coupled them.
2. **Observability measured the transport, not the outcome.** Uptime and 2xx-rate
   dashboards stayed green because the transport *was* healthy. No metric existed for
   "normalized events produced," and no alarm for "unknown payload shape."
3. **The rehearsal step was skipped** — the sandbox had the toggle flipped weeks earlier
   by a different engineer, so the team's sandbox "worked" while production didn't,
   reinforcing false confidence.

## What went well

- CDC reconciliation existed and the gap fit inside the 30-day lookback window — the
  difference between a 2-day backfill and a multi-week full-resync program.
- Raw payload logging (added for an earlier debugging session) made root-cause
  identification fast once a human finally looked.

## What went wrong

- 19 days of silence: the failure produced no signal that anyone watched.
- Customer discovered the incident before the vendor did — trust damage exceeds the
  technical damage.
- 37 conflicting edits needed manual, per-record resolution because changes kept being
  made on both sides during the gap.

## Where we got lucky

- The bookkeeper reconciled monthly. A quarterly-close customer would have pushed the
  gap past CDC's 30-day window, forcing a full resync with much harder conflict
  resolution.

## Action items

| # | Action | Type | Owner | Status |
|---|--------|------|-------|--------|
| 1 | Dual-format normalizer with `unknownFormat` alarm (page at > 0) | prevent | consumer team | done (this chapter's reference impl) |
| 2 | "Events processed per hour" metric + zero-volume watchdog vs 7-day baseline | detect | consumer team | done |
| 3 | Scheduled canary round-trip asserting end-to-end freshness SLO | detect | consumer team | open |
| 4 | Couple platform-toggle changes to the deploy checklist (runbook step 3) | process | on-call | done ([runbook](./runbook.md)) |
| 5 | Standing CDC reconciliation sweep, interval < 30-day CDC window ÷ 2 | mitigate | sync team | open |

## The one-sentence lesson

**A webhook consumer that can return "zero events" for a payload it doesn't understand
will eventually do exactly that, silently, in production — make "I don't understand
this payload" a first-class, alarmed outcome.**
