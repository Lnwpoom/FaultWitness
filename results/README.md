# Experiment results

Each `lab experiment` run writes `experiment-<timestamp>.md` (the slide tables) and `.jsonl` (every Result of every Round, tagged with its Scenario and phase).

Latest run: [`experiment-2026-10-05T11-09-42.md`](experiment-2026-10-05T11-09-42.md), measured in the Docker Lab in the build sandbox: **55/55 Rounds correct, 0 false alarms**. Every Fault in the main table raised the alert in the second Round after it was created, 20–26 s by wall clock (target: under 30 s).

Notes for the slides:
- **`cutA` is correct as "ข้อมูลไม่พอ".** With Probe A unreachable, the honest answer is "no latest Results from A" (Insufficient Data). That is the expected Diagnosis for this Fault, so those Rounds count as *correct*, not under the "ข้อมูลไม่พอ" column, which counts Insufficient Data given when something else was expected.
- **`blipA` never alerts by design.** Its one Round is `probe|A` at the initial level, and the next Round is back to normal.
- **`slowA` was not run here.** The sandbox kernel has no netem. Run `npm run lab -- experiment --scenario slowA` on the presentation laptop to fill that row.

Screenshots of the dashboard during Faults in the Lab: [`dashboard-certX.png`](dashboard-certX.png) (Site X's certificate expired: "the server answered, the network is fine") and [`dashboard-dnsA.png`](dashboard-dnsA.png).
