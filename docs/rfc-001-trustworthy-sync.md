# RFC-001 — What a trustworthy QuickBooks sync looks like

- **Status:** Living document (v0.1)
- **Author:** Ehsan Shahsavan
- **Scope:** design principles this lab's chapters test against; not a product spec

## Problem

Accounting sync failures have a property most software failures don't: **they are
discovered by accountants, not by monitoring.** A dropped webhook, a duplicated
invoice, or a lost field doesn't crash anything — it quietly diverges two ledgers, and
the divergence surfaces at reconciliation, weeks later, as damaged trust. Users who
have been burned once stop trusting the sync entirely and fall back to double entry,
which defeats the product's reason to exist.

So the design goal is not "sync that works" — every demo works. The goal is **sync
whose failures are visible, bounded, and recoverable**.

## Definitions

- **Divergence** — the two systems disagree about a record and neither side knows it.
- **Freshness** — time from a change in one system to its correct application in the other.
- **Reconciliation** — a scheduled comparison that discovers divergence independently
  of the event pipeline (in QBO terms: a CDC sweep, bounded by its 30-day window).
- **Blind retry** — re-issuing a write without knowing whether the first attempt landed.

## Principles

### P1 — Webhooks are a latency optimization; reconciliation is the source of truth

QBO webhooks are best-effort and carry no field data. Any architecture that treats
them as the delivery guarantee inherits every gap as silent divergence. A standing
CDC sweep bounds the damage of *any* event-pipeline failure to one sweep interval —
provided the interval stays comfortably inside CDC's 30-day lookback.
*Tested by: chapter 01 (CloudEvents migration), CDC-window chapter (roadmap).*

### P2 — Every write must be idempotent or explicitly non-retryable

Before retrying any failed write, answer one question: **"can a blind retry create bad
data?"** Throttles (429) and transient 5xx: retry with jittered backoff. Validation
and business failures (4xx): never blind-retry — that is how duplicate invoices are
born. Where QBO offers idempotency hooks, use them; where it doesn't, deduplicate on
your side before writing.
*Tested by: duplicate-paths and rate-limit chapters (roadmap).*

### P3 — Classify errors before handling them

A sync engine that treats all errors alike either over-retries (creating duplicates)
or under-retries (dropping changes). The minimum viable taxonomy this lab uses:
`AUTH_EXPIRED`, `INSUFFICIENT_SCOPE`, `RATE_LIMITED`, `DUPLICATE`, `VALIDATION`,
`TRANSIENT` — each with a distinct handling policy, and `VALIDATION` never retried
blindly.

### P4 — Prevent before write, don't just resolve after failure

QBO rejects writes for knowable reasons: field length limits, invalid characters,
entity name collisions, missing references. Validating the payload against those
rules *before* the write converts a user-visible sync conflict into a non-event.
Prevention is cheaper than resolution in every currency that matters — API calls,
support tickets, and user trust.

### P5 — "I don't understand this" is a first-class, alarmed outcome

Parsers, mappers, and state machines must never convert "unrecognized input" into
"empty result." Chapter 01 is the canonical case: one optional-chained parser turned a
payload format migration into 19 simulated days of silent data loss. Unknown input
increments a counter that pages at > 0.

### P6 — Measure outcomes, not transport

Uptime and 2xx-rate dashboards stay green through most real sync failures. The
metrics that matter measure the *outcome*: events applied, freshness percentiles,
divergence found by reconciliation, dead-letter age. See [slo.md](./slo.md).

## Alternatives considered

- **"Real-time only" (no reconciliation):** simpler, and how many integrations start.
  Rejected: P1 — every delivery gap becomes unbounded silent divergence.
- **"Full resync on any doubt":** maximally safe, but at QBO's 500 req/min/realm
  throttle a full resync of a large company is hours of degraded freshness for all
  entities. Reserved for CDC-window overruns, not routine recovery.
- **Official SDK for the lab's client:** rejected for this repo only — chapters need
  raw requests/responses visible to inspect failures ([decisions.md](./decisions.md), D-002).

## Open questions

- QBO's concurrent-request limit is reported as 10 in some sources and 40 in others;
  the rate-limit chapter should measure it empirically in sandbox.
- Whether CloudEvents delivery changes retry behavior vs the legacy pipeline is not
  publicly documented; the canary harness can measure delivery latency distributions
  before/after.
