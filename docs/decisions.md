# Decision log

Format: context → decision → consequences. Newest first.

---

## D-005 — Simulated postmortems, clearly labeled

**Context:** postmortems are the highest-signal reliability artifact, but this is a lab,
not a production service with real incidents to publish.
**Decision:** each chapter ships a postmortem for a *fictional* company, labeled as
simulated in the first line, with every technical detail reproducible from the
chapter's fixtures and tests.
**Consequences:** readers get the full incident-reasoning artifact without anyone's
production data; the label keeps it honest. The risk of looking "academic" is offset
by the runnable repro sitting next to it.

## D-004 — Fixtures first; live sandbox second

**Context:** requiring an Intuit developer account + sandbox + OAuth dance to see
anything work would lose most readers in setup.
**Decision:** every chapter must reproduce its failure offline from recorded fixtures
(`npm test`, zero config). Live-sandbox repro is the optional second step, and
fixtures note where a captured real payload should replace/verify a recorded one.
**Consequences:** 30-second time-to-first-repro; fixtures must be kept honest against
real captures as the platform evolves.

## D-003 — Hand-rolled ~100-line QBO client instead of the official SDK

**Context:** Intuit ships official SDKs (Java, PHP, .NET, Node community).
**Decision:** the lab uses a minimal typed client (`src/qbo/client.ts`).
**Consequences:** every request/response is visible on one screen, which is the point
when the subject matter *is* the failure behavior (429 shapes, error bodies, retry
semantics). Not a recommendation against SDKs in production apps — the tradeoff
reverses when you're building features rather than inspecting failures.

## D-002 — TypeScript + node:test, no framework

**Context:** the harness needs to run anywhere with one `npm install`.
**Decision:** TypeScript with `tsx`, Node's built-in test runner, zero runtime
dependencies (node:http, node:crypto).
**Consequences:** nothing to configure, nothing to go stale; contributors need no
framework knowledge. The receiver is intentionally plain `node:http` — ~80 lines that
show the raw-body handling that signature validation actually depends on.

## D-001 — A lab, not a product

**Context:** the gap this repo fills is a public, reproducible catalog of QuickBooks
sync failure modes with operational artifacts (runbooks, postmortems, SLOs). Adjacent
open-source niches (SDK clients, full sync platforms) are either crowded or beyond a
credible solo scope.
**Decision:** scope = reproduce real failure classes + document detection and recovery.
Explicitly out of scope: being a production sync engine, covering every entity, or
wrapping the whole API.
**Consequences:** each chapter is independently useful and honestly sized; "lab"
framing sets accurate expectations and avoids overclaiming.

## D-000 — Clean-room sourcing policy

**Context:** the author has built commercial QuickBooks sync tooling; employers' code
and internals are not publishable.
**Decision:** everything in this repo derives exclusively from public sources — Intuit
developer documentation and blog, Intuit's official sample apps, public developer-forum
threads — and from experiments against the author's own sandbox company. No employer
code, data, or internal designs.
**Consequences:** every claim carries a public citation or a runnable repro; a few
platform behaviors stay "open questions" until measured in sandbox rather than assumed
from experience.
