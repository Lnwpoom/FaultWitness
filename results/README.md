# Experiment results

Each `lab experiment` run writes `experiment-<timestamp>.md` (the slide tables) and `.jsonl` (every Result of every Round, tagged with its Scenario and phase).

Latest run, on the final code: [`experiment-2026-10-05T11-33-45.md`](experiment-2026-10-05T11-33-45.md), measured in the Docker Lab in the build sandbox: **55/55 Rounds correct, 0 false alarms**. The earlier run [`experiment-2026-10-05T11-09-42.md`](experiment-2026-10-05T11-09-42.md), made before the review fixes, gave the same figures. Every Fault in the main table raised the alert in the second Round after it was created, 20–26 s by wall clock (target: under 30 s).

Notes for the slides:
- **`cutA` is correct as "ข้อมูลไม่พอ".** With Probe A unreachable, the honest answer is "no latest Results from A" (Insufficient Data). That is the expected Diagnosis for this Fault, so those Rounds count as *correct*, not under the "ข้อมูลไม่พอ" column, which counts Insufficient Data given when something else was expected.
- **`blipA` never alerts by design.** Its one Round is `probe|A` at the initial level, and the next Round is back to normal.
- **`slowA` was measured on a laptop instead.** The sandbox kernel has no netem, so that run shows `slowA` as not run. [`experiment-2026-10-05T13-32-34.md`](experiment-2026-10-05T13-32-34.md) measured it on a Mac with Docker Desktop: **5/5 Rounds correct, 0 false alarms**. Probe A's requests took about 355 ms on average against about 16 ms for Probe B, and every Round reported normal plus the Observation that A is slow.

Screenshots of the dashboard during Faults in the Lab: [`dashboard-certX.png`](dashboard-certX.png) (Site X's certificate expired: "the server answered, the network is fine") [`dashboard-dnsA.png`](dashboard-dnsA.png), and [`dashboard-stale.png`](dashboard-stale.png) (no new Results for over 25 s: the dashboard says Insufficient Data instead of showing the old Round as current).
