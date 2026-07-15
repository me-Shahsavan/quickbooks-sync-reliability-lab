# SLOs for a two-way accounting sync

Transport metrics (uptime, 2xx rate) stay green through most real sync failures.
These four SLOs measure what users actually experience. Targets below are illustrative
starting points for an SMB integration — the point is the *set of definitions*, which
any sync team can adopt and re-target.

## SLO 1 — Freshness

> **p95 time from a change in system A to its correct application in system B ≤ 5 minutes;
> p99.9 ≤ 1 hour.**

- **Measured by:** canary round-trip — on a schedule, modify a designated canary entity
  in QuickBooks and measure until the change is applied downstream (and vice versa).
- **Why p99.9 matters more than p95 here:** the tail *is* the product. A sync that is
  instant usually and silently 3 days late occasionally is experienced as untrustworthy.

## SLO 2 — Delivery coverage

> **≥ 99.5% of changes discovered via the event pipeline (webhooks) rather than
> reconciliation; 100% discovered within one reconciliation interval.**

- **Measured by:** every reconciliation (CDC) sweep tags each discovered change as
  `already-seen` (webhook got it) or `missed` (webhook gap). The miss rate is the
  event pipeline's real reliability — a number almost no sync team knows about itself.
- **Alarm:** any sweep with `missed > 0` after a platform change (e.g. a payload format
  migration — see chapter 01).

## SLO 3 — Divergence

> **Zero unexplained record-level mismatches per reconciliation sweep; any mismatch
> triaged within one business day.**

- **Measured by:** field-level comparison of a sampled record set per sweep, plus 100%
  comparison of records touched in the last interval.
- This is the SLO accountants would write if we let them: "the two systems agree."

## SLO 4 — Write safety

> **≥ 99% of failed writes recovered automatically (classified retry or queued fix);
> dead-letter queue age p100 < 24h; zero duplicates created by retries.**

- **Measured by:** error-taxonomy counters (`RATE_LIMITED` retried, `VALIDATION` queued
  for fix, never blind-retried), dead-letter age gauge, and a periodic duplicate-scan
  on recently-written entities.
- The zero-duplicates clause is deliberately absolute: a duplicate invoice is a
  customer-visible accounting error, not a degraded experience.

## Error budget policy

Each SLO carries a monthly error budget. The policy that gives budgets teeth:

- **Budget intact** → ship sync features.
- **Budget burned > 50% mid-month** → next sprint prioritizes the top failure chapter
  (by budget burn) from this catalog over feature work.
- **Budget exhausted** → freeze risky changes to the pipeline (including provider-side
  toggles like payload format flips) until reconciliation shows two clean sweeps.

## Instrumentation reference

The receiver in this repo ([`src/webhooks/receiver.ts`](../src/webhooks/receiver.ts))
demonstrates the minimum counter set: `deliveries`, `eventsProcessed`, `unknownFormat`,
`badSignature`. SLO 2's tagging logic and the canary harness are on the
[roadmap](../README.md#roadmap).
