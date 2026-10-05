# FaultWitness

When "the internet is broken", FaultWitness says **where**. Two Probes (A and B) test an Internal Service and two External Sites over HTTP, DNS and TCP; a Collector compares their Results every 10 seconds and explains, in Thai, where the fault is, why it thinks so, what it does not yet know, and what to check next. When the evidence is incomplete it says **ข้อมูลยังไม่พอ** (insufficient data) instead of guessing.

- Spec: [issue #2](https://github.com/Lnwpoom/cloud_Developer2/issues/2). Vocabulary: [`GLOSSARY.md`](GLOSSARY.md). Decisions: [`docs/adr/`](docs/adr/).
- Measured accuracy: [`results/`](results/) (written by `lab experiment`).
- Design prototype: [`prototypes/network-projects/PROTOTYPE-faultwitness.html`](prototypes/network-projects/PROTOTYPE-faultwitness.html).

## Requirements

- Node.js 22.18 or newer (runs the TypeScript sources directly).
- Docker with Compose v2, for the Lab.

```
npm ci
npm run typecheck && npm run lint && npm test
```

## How to demo

1. **Start the Lab** (two Probes, the Collector, an Internal Service, Site X, Site Y, a resolver and a gateway, all on this machine; no Wi-Fi needed):
   ```
   npm run lab -- up
   ```
2. **Open the dashboard** at <http://localhost:8080/> on the big screen. It refreshes every 2 seconds; **ตรวจเดี๋ยวนี้** runs a Round immediately. Within a few seconds it shows **ปกติ** with both Probes reporting.
3. **Break something, then fix it:**
   ```
   npm run lab -- faults          # the 11 Faults, each with a Thai description and the expected Diagnosis
   npm run lab -- fault certX     # e.g. Site X's certificate expires
   npm run lab -- status          # containers and the Faults now active
   npm run lab -- clear           # back to normal
   ```
   The first Round after a Fault shows a Finding at **เบื้องต้น** (initial) without an alert; the second raises **🔔 แจ้งเตือน**. Good ones to show judges: `dnsA` (DNS, not the network), `certX` (the server, not the network), `clockA` (one Probe's clock), `egress` (shared exit, without blaming the ISP), `blipA` (a one-Round blip never alerts), `cutA` (a silent Probe gives insufficient data, not a guess).
4. **Measure accuracy for the slides** (about 14 minutes at the real 10-second cadence):
   ```
   npm run lab -- experiment            # main table (5 Scenarios × 5 Rounds) and extended table
   npm run lab -- experiment --main     # main table only
   npm run lab -- experiment --scenario dnsA
   ```
   Writes `results/experiment-<timestamp>.md` (the tables) and `.jsonl` (every Result). Ctrl-C stops it and leaves the Lab normal.
5. `npm run lab -- down` removes everything.

**`slowA` needs netem.** The "A is slow but works" Fault delays Probe A's packets with `tc qdisc … netem`, which needs the kernel's `sch_netem` module. Docker Desktop and most Linux laptops have it; the cloud sandbox where the committed results were measured does not, so there `slowA` is reported as *not run*. It was measured separately on a laptop with Docker Desktop: [`results/experiment-2026-10-05T13-32-34.md`](results/experiment-2026-10-05T13-32-34.md).

See [`lab/README.md`](lab/README.md) for the Lab's topology and troubleshooting.

## Running outside the Lab

Everything (Probe and Collector addresses, Targets, fixed IPs, cadence, Stale limit, timeouts) is in one JSON config; [`config/local.json`](config/local.json) is an example.

To try it on one machine with [`config/local.json`](config/local.json): it expects an Internal Service on `127.0.0.1:7200` and uses two public HTTPS sites (`one.one.one.one` at 1.1.1.1 and `dns.google` at 8.8.8.8) as External Sites, so it needs internet access. Start a stand-in Internal Service, then both Probes and the Collector, each in its own terminal:

```
node -e "require('node:http').createServer((q, r) => r.end('ok')).listen(7200, '127.0.0.1')"
PROBE_ID=A npm run probe
PROBE_ID=B npm run probe
npm run collector               # dashboard on http://localhost:8080/
```

On real machines, put each Probe's and the Collector's address in the config and run:

```
PROBE_ID=A npm run probe        # on Probe A's machine
PROBE_ID=B npm run probe        # on Probe B's machine
npm run collector               # on the Collector; dashboard on collector.port
```

`FAULTWITNESS_CONFIG=<path>` selects another config. The Probe and Collector APIs have no authentication: use them only on a trusted network (a Probe refuses tests against anything not in its config).
