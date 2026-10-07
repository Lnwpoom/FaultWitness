# Witness Pair — implementation checks

6 October 2026 (Asia/Bangkok). Working branch: `design/evidence-desk-v0`.

The user selected variant 2 from the Evidence Desk v0. Production now uses that layout with live reports; the original three-layout prototype remains available separately.

## Completed

- `npm run typecheck`: passed.
- `npm run lint`: passed. Repository lint does not inspect inline HTML scripts.
- `npm run build`: passed; the compiled distribution includes `index.html`, both Thai font files and their license in `dist/dashboard`.
- Inline production JavaScript parsed successfully with Node's `vm.Script`.
- `npm test`: **101 tests passed, 9 files**. The new Collector HTTP integration test first failed with 404, then passed after the exact font/license routes were added. Loopback tests ran outside the filesystem/network sandbox.
- `git diff --check`: passed.
- Docker Lab rebuilt with the final implementation. `lab selfcheck`: **7 checks passed**.
- `lab experiment --scenario dnsA`: **5/5 correct, 0 false alarms**, alert in the second round, **24 seconds** after the fault was introduced. [Recorded experiment](../results/experiment-2026-10-06T11-29-35.md) and [Results](../results/experiment-2026-10-06T11-29-35.jsonl).
- Opened the live page in Chrome and observed the real DNS Finding and its supporting/missing evidence. After the experiment returned the Lab to normal, the dashboard showed normal and no alert.
- Clicked “ตรวจเดี๋ยวนี้” in the production page: the completed report showed round 17, normal, 6 Results; the completion announcement was displayed.

## Scope and handoff

Live app: <http://localhost:8080/>. Docker Lab is left running in normal state for the user to inspect. [Screenshot of the live normal state](../results/dashboard-witness-pair.jpg).

No Diagnosis rule or Report schema was changed. Assets are served locally without CDN dependencies. API routes remain compatible, with three exact asset routes added. No merge, push or deployment was performed.

This was implementation verification and a local preview, not a cross-viewport/browser acceptance run. The complete multi-scenario Docker experiment and user comprehension study were not repeated; the focused DNS experiment above is the new measurement.

## Two-page production replacement — 7 October 2026

User approved replacing the existing dashboard with v2 and explicitly asked to finish without real testing. Updated the production HTML to the left-nav two-page shell, independent scroll regions and sticky table headers. Integrated the existing live polling, manual Round request, request-order guards, disconnected/stale/no-data handling, announcements and DOM patching. Existing `faultwitness-display-v1` theme/density/emphasis settings are retained. Added the exact local Block Craft OTF route and asset.

Validation for this revision is limited to inline-script syntax, static DOM-ID checks, TypeScript compilation/build and whitespace checks. No browser session, Collector request, automated test suite, Docker rebuild or Lab experiment was run. Earlier runtime results above belong to the earlier design. The running Docker app is not redeployed as part of this source replacement.
