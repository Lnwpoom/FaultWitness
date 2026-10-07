# FaultWitness / Evidence Desk v0

Approved direction: Evidence Desk, 6 October 2026. Primary audience: judges and viewers of a live demonstration.

## Identity and assets

- Product name: **FaultWitness**, retained as the existing text wordmark. No substitute logo or new identity mark was introduced. No official logo asset was found in the project; adding a new one is outside this v0.
- Actual reference UI: `../../results/dashboard-dnsA.png`, `../../results/dashboard-certX.png`, `../../results/dashboard-stale.png`. These are source evidence, not decorative images used in the dashboard.
- Display and body font: IBM Plex Sans Thai, Regular (400) and SemiBold (600), embedded unchanged in the portable HTML. Fallback: Tahoma, sans-serif. Raw data retains the platform monospace fallback.
- Local font files: `assets/fonts/IBMPlexSansThai-Regular.ttf`, `assets/fonts/IBMPlexSansThai-SemiBold.ttf`.
- Font source: [Google Fonts repository metadata](https://github.com/google/fonts/blob/main/ofl/ibmplexsansthai/METADATA.pb). License retained in `assets/fonts/OFL.txt` and embedded in the HTML. [IBM Plex project](https://github.com/IBM/plex).
- No product imagery, illustrations, icons or charts are necessary for this data comparison prototype.

## System

Light: `#FAFAF9` background, `#FFFFFF` surface, `#1C1917` ink, `#57534E` secondary text, `#D6D3D1` dividers. Dark: `#1C1917` background, `#262220` surface, `#F5F5F4` ink, `#D6D3D1` secondary, `#57534E` dividers.

Teal `#0F766E` / `#5EEAD4` identifies interaction and evidence. Green `#15803D` / `#4ADE80` is successful test Results, red `#B91C1C` / `#F87171` is failed Results/alerts, amber `#B45309` / `#FBBF24` is stale or insufficient data. Soft semantic backgrounds are retained from the original dashboard palette. Text labels carry all status meanings alongside color.

Four-pixel spacing base. Main text 18px, presentation setting 24px. Main conclusion 32–44px across responsive sizes, section labels 24px. Content radius 4px, controls 6px. Shadows only on floating controls. State transitions 140ms, disabled for reduced motion.

## Design read

Redesign-overhaul of visual language, preserving domain and technical contracts. Variance 6, motion 2, density 6, asset dependence 2, brand fidelity 6. A/B alignment is the signature move; no invented topology, historical trend, uptime or confidence score is shown.

## V2 user-confirmed revision

Reference image 1 contributes the left navigation and rounded app frame only. Preserve FaultWitness warm neutrals, teal accent and semantic status colors. Font asset: `assets/fonts/BlockCraft.otf`, supplied in the confirmed `block-craft.zip`; display use for FaultWitness and A/B. No Thai coverage: retain the local IBM Plex Sans Thai for Thai UI. No separate license text accompanied the supplied OTF; do not attribute the IBM font OFL to Block Craft.
