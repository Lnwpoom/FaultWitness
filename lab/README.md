# Lab (ห้องแล็บ)

A self-contained replica network for FaultWitness on one machine, in Docker Compose. Needs Docker with Compose v2 and Node 22.18+ on the host (the `lab` CLI runs TypeScript directly).

```
npm run lab -- up          # build and start
npm run lab -- selfcheck   # verify routing, naming, certificates, faketime
npm run lab -- status
npm run lab -- down        # remove containers and networks
```

## Topology

| Network | Subnet | Members |
|---|---|---|
| `inner` (bridge `fw-inner`) | 10.77.1.0/24 | Collector .10, Probe A .11, Probe B .12, Internal Service `intranet.lab:8081` .20, resolver .53, gateway .254, toolbox .99 |
| `outer` (bridge `fw-outer`) | 10.77.2.0/24 | Site X `site-x.lab` .10, Site Y `site-y.lab` .11, gateway .254 |

- Inner containers route `10.77.2.0/24` via the gateway (10.77.1.254), which forwards without NAT; the sites route back via 10.77.2.254.
- dnsmasq on 10.77.1.53 is the system resolver of the Probes and answers only the Lab names.
- One image (`lab/Dockerfile`) serves every role; certificates come from a Lab CA generated at build time. Site X also holds an expired certificate: `docker compose -f lab/compose.yaml exec site-x use-cert expired|valid`.
- Probe Node processes run under libfaketime (`/lab/bin/faketime-node`); write `@2019-01-01 00:00:00` or `+0` to `/run/faketime/rc` in the container to move its clock at runtime.
- The two bridges trust each other (`com.docker.network.bridge.trusted_host_interfaces`). Without it, Docker 28+ drops the routed traffic between them.

## Troubleshooting

- `429 Too Many Requests` from Docker Hub while building: pull the bases from a mirror and tag them, e.g. `docker pull mirror.gcr.io/library/ubuntu:24.04 && docker tag mirror.gcr.io/library/ubuntu:24.04 ubuntu:24.04` (same for `node:22`).
- Behind a local HTTP proxy, the CLI builds with the host network automatically; override with `LAB_BUILD_NETWORK`.
