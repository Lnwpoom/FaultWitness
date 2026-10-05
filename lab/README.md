# Lab (ห้องแล็บ)

A self-contained replica network for FaultWitness on one machine, in Docker Compose. Needs Docker with Compose v2 and Node 22.18+ on the host (the `lab` CLI runs TypeScript directly).

```
npm run lab -- up          # build and start
npm run lab -- selfcheck   # verify routing, naming, certificates, faketime
npm run lab -- status      # containers and active Faults
npm run lab -- faults      # list Faults
npm run lab -- fault dnsA  # create one
npm run lab -- clear       # undo all
npm run lab -- experiment  # measure accuracy, write results/
npm run lab -- down        # remove containers and networks
```

The dashboard and API are on <http://localhost:8080/>, the only port published to the host.

## Faults

Defined in one table, `lab/faults.ts`, with each Fault's Thai label, mechanism and expected Diagnosis keys (the experiment scores against the same table).

| Fault | Mechanism | Expected |
|---|---|---|
| `dnsA` / `dnsB` | iptables on that Probe drops the resolver's answers (lookups time out) | `dns\|A` / `dns\|B` |
| `routeA` | iptables on Probe A drops traffic to the Internal Service's port only | `probe\|A` |
| `blipA` | `routeA` for one Round, cleared automatically after the Round that sees it | `probe\|A` initial, no alert, then normal |
| `localDown` | stop the Internal Service container | `dest\|local-service` |
| `siteXDown` | iptables on Site X answers 443 with tcp-reset | `dest\|site-x` |
| `certX` | Site X serves its expired certificate (waits until every old nginx worker is gone) | `dest\|site-x` |
| `egress` | iptables on the gateway drops forwarding to `outer` | `shared` |
| `clockA` | Probe A's faketime file set to `@2019-01-01 00:00:00` | `probe\|A` |
| `slowA` | `tc qdisc add dev eth0 root netem delay 100ms` on Probe A; refused cleanly where netem is missing | normal + an Observation that A is slower |
| `cutA` | disconnect Probe A from `inner`; `clear` reconnects it and restores its route | `insufficient` |

## Topology

| Network | Subnet | Members |
|---|---|---|
| `inner` (bridge `fw-inner`) | 10.77.1.0/24 | Collector .10, Probe A .11, Probe B .12, Internal Service .20 (port 8081, addressed by IP), resolver .53, gateway .254, toolbox .99 |
| `outer` (bridge `fw-outer`) | 10.77.2.0/24 | Site X `site-x.lab` .10, Site Y `site-y.lab` .11, gateway .254 |

- Inner containers route `10.77.2.0/24` via the gateway (10.77.1.254), which forwards without NAT; the sites route back via 10.77.2.254.
- dnsmasq on 10.77.1.53 is the system resolver of the Probes and answers only the Lab names.
- One image (`lab/Dockerfile`) serves every role; certificates come from a Lab CA generated at build time. Site X also holds an expired certificate: `docker compose -f lab/compose.yaml exec site-x use-cert expired|valid`.
- Probe Node processes run under libfaketime (`/lab/bin/faketime-node`); write `@2019-01-01 00:00:00` or `+0` to `/run/faketime/rc` in the container to move its clock at runtime.
- The two bridges trust each other (`com.docker.network.bridge.trusted_host_interfaces`). Without it, Docker 28+ drops the routed traffic between them.

## Troubleshooting

- `429 Too Many Requests` from Docker Hub while building: pull the bases from a mirror and tag them, e.g. `docker pull mirror.gcr.io/library/ubuntu:24.04 && docker tag mirror.gcr.io/library/ubuntu:24.04 ubuntu:24.04` (same for `node:22`).
- Behind a local HTTP proxy, the CLI builds with the host network automatically; override with `LAB_BUILD_NETWORK`.
