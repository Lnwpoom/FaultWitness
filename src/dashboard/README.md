# Witness Pair dashboard

The Collector serves `index.html` at `/` and `/index.html`. This is the approved two-page Evidence Desk design from `prototypes/evidence-desk/evidence-desk-v2.html`, based on the selected Witness Pair layout. The prototype remains a separate recorded-data artifact; production only reads live Collector reports.

- Poll `GET /report` every two seconds after each request completes; `POST /rounds` triggers a manual Round.
- Keep Diagnosis text, evidence, missing evidence, next steps, observations and raw Results from the Report.
- A disconnected browser cannot verify current network status. The previous report is labelled for reference; Collector-reported `stale` remains a separate condition. No client-side stale threshold is invented.
- Left navigation switches between analysis (`#overview`) and raw Results (`#results`) without starting a Round.
- Evidence, explanations and raw Results scroll independently inside a viewport-height shell. Table headers stick within their panel; each region supports keyboard focus/scrolling. There is no pagination.
- Update text/attributes in existing DOM nodes. Scroll regions are not recreated by polling or navigation, preserving reading position while content permits.
- Announce meaningful status changes; do not announce every one-second age update.
- Request ordering and Collector timestamps prevent late responses from replacing newer reports. Requests have finite client timeouts; an aborted manual request is not automatically retried because the Collector may still complete it.
- Theme, text size and failure emphasis are saved under `faultwitness-display-v1`; storage failure does not block the dashboard.

## Offline assets

IBM Plex Sans Thai Regular and SemiBold are kept in `assets/` with their OFL license. They were obtained for the approved prototype from the [Google Fonts repository](https://github.com/google/fonts/tree/main/ofl/ibmplexsansthai). Block Craft is supplied by the user and used for the wordmark and A/B. It has no Thai glyphs, so Thai text uses IBM Plex Sans Thai. The supplied OTF did not include a separate license file; the OFL applies to IBM Plex Sans Thai only. The exact font paths (including `/assets/BlockCraft.otf`) and `/assets/OFL.txt` are served; other asset paths return 404. Font source and the broader visual system are documented in [the design asset record](../../prototypes/evidence-desk/brand-spec.md).

`npm run build` copies this directory to `dist/dashboard` after compiling TypeScript, so compiled Collector execution can also serve the page and fonts. No CDN, framework or runtime dependency is required.

## Integration handoff — 7 October 2026

The user explicitly requested replacing the project dashboard and finishing without further real testing. This integration was checked only for inline JavaScript syntax and compilation/build; no browser, live Collector, automated test suite or Docker Lab was run for this revision. Earlier checks recorded in `docs/dashboard-implementation-checks.md` predate this integration and do not certify it. Existing HTTP tests cover the original IBM font routes; the new Block Craft route has not been runtime-tested in this revision.
