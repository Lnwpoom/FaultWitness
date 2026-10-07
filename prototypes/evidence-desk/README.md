# Evidence Desk v0

Branch: `design/evidence-desk-v0`

Open **[evidence-desk-v0.html](evidence-desk-v0.html)** directly in a browser. It is a portable offline HTML file with embedded fonts, license, CSS, JavaScript and recorded data. No build or server is needed to view the delivered file.

## Compare the three layouts

1. **Conclusion first:** conclusion and recommended next steps lead, evidence follows.
2. **Witness Pair (default):** aligned A/B evidence alongside the explanation.
3. **Evidence sequence:** conclusion, comparison, explanation and next steps run vertically.

The same report is retained when changing layouts. Use the scenario selector for DNS A, certificate X, stale data, or normal Results. Open **Tweaks** for theme, presentation text size and failed-result emphasis. Raw Results and provenance are available below the dashboard.

This is a direction prototype for a presentation to judges, not the production dashboard. “ตรวจเดี๋ยวนี้” is deliberately disabled with an explanation because the prototype does not contact the Collector. Live polling, loading/error flows and full state coverage belong to the next stage after the user chooses a direction.

Recorded browser previews: [Conclusion first](previews/01-conclusion-first.jpg), [Witness Pair](previews/02-witness-pair.jpg), [Evidence sequence](previews/03-evidence-sequence.jpg). The live HTML is the best way to compare at the same viewport and scroll position; these captures include the local browser's extension overlays.

## Data provenance

The source is `results/experiment-2026-10-05T17-07-03.jsonl`. The build selects each scenario's warmup and first two observed rounds, then uses the project's actual `diagnose()` and `toReport()` functions. It does not invent Results or diagnosis text.

| Selector | Recorded scenario | Last round | Evaluation time |
|---|---|---:|---|
| DNS A | dnsA | 92 | Actual round completion |
| Certificate X | certX | 134 | Actual round completion |
| Normal | normal | 85 | Actual round completion |
| Stale | normal | 85 | **Simulated:** completion + configured stale limit + 6 seconds |

Stale is explicitly a time simulation over real recorded Results, not a recorded live outage. Source SHA-256 and provenance are embedded with each fixture. The UI displays timestamps in Asia/Bangkok. Source filenames use the experiment's original timestamp and are not substituted for local dates.

## Rebuild

From the repository root, with Node 22.18 or later:

```sh
node prototypes/evidence-desk/build.mjs
```

Edit `template.html`, then rebuild `evidence-desk-v0.html`. The template is build input, not a directly viewable deliverable: fonts and fixtures are inserted by the build. Font sources and license are local in `assets/fonts/`.

Optional local preview:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory prototypes/evidence-desk
```

Then open <http://127.0.0.1:8765/evidence-desk-v0.html>.

## Scope and review checkpoint

Production source, API, data contracts and diagnosis rules are unchanged. No framework or runtime dependency was added. The existing design review is [here](../../docs/dashboard-design-review.md); the visual asset record is [brand-spec.md](brand-spec.md).

At the v0 checkpoint, choose a layout or combine specific parts before building production interactions. This deliverable does not claim responsive/browser acceptance or user comprehension testing.

## Checks completed

- Portable HTML rebuilt and inline JavaScript parsed successfully; no unresolved build markers.
- Inspected the preview in Chrome and switched layouts to capture the alternatives.
- Repository typecheck and lint passed; 100 existing tests passed (9 files). Tests requiring loopback ports were rerun outside the sandbox after its port restrictions blocked setup. The repository lint/test configuration does not cover prototype HTML, so these results do not substitute for browser acceptance.
- No Docker experiment was rerun: this v0 only reads recorded Results and leaves the operational app unchanged.

## Two-page v2 draft — 7 October 2026

Open [evidence-desk-v2.html](evidence-desk-v2.html) or <http://127.0.0.1:8765/evidence-desk-v2.html>. This is the new review draft; v0 remains available for historical comparison. The selected Witness Pair layout was already implemented in production before this separate v2 iteration.

V2 uses the reference's left navigation and rounded frame with the original FaultWitness palette. Overview and raw Results are separate pages sharing one recorded Report. Theme, audience size and failed-result emphasis have separate icon controls. As revised by the user, all content stays in independently scrollable evidence, explanation and raw Results panels. The page shell stays fixed; table headers remain sticky. Tab focuses each region for keyboard scrolling. Pagination and its measuring/splitting code have been removed.

Block Craft comes from the user-confirmed `/Users/rockthestar/Downloads/block-craft.zip` and is embedded for the wordmark and A/B. It has no Thai glyphs; Thai text remains IBM Plex Sans Thai. The ZIP supplied only the OTF, without a separate license document. The existing OFL is specifically for IBM Plex Sans Thai.

Rebuild: `node prototypes/evidence-desk/build.mjs --v2`. Edit `template-v2.html`; the same build pipeline reconstructs the four recorded scenarios. No runtime dependencies or production changes were added for this draft.

Historical pagination preview checks (before the scrolling revision): Chrome at 1366×650 showed matching document/viewport dimensions for the overview (standard and presentation DNS) and raw Results (presentation DNS), with visible panel content within its available height. DNS explanation pages exposed supporting evidence, missing evidence and next steps. At 1440×800, raw Results in presentation mode exposed all 14 rows over three pages; standard/light mode showed rows 1–9 then 10–14 and matching document/viewport dimensions. A 1920×900 raw preview was also opened, but no full state-by-viewport matrix or mobile acceptance is claimed. Screenshots are in `previews/v2-*.jpg`.

### Internal scrolling revision

The user replaced pagination with scrolling inside each panel. Checked Chrome at 1366×650 in presentation mode with the DNS fixture: the document stayed 1366×650 with `scrollY=0` after scrolling the evidence and explanation panels to their ends. Raw Results contained all 14 rows; keyboard End reached scrollTop 539.5 in a 357px-high panel with 896px of content, and the sticky header aligned with the panel top. Changing views preserves existing panel DOM and scroll positions. Syntax/build-marker checks passed. No backend changes or backend test rerun were needed. Latest screenshot: [v2 internal scrolling](previews/v2-internal-scroll.jpg).
