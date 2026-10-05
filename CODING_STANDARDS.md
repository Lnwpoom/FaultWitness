# Coding standards

FaultWitness is TypeScript on Node 22. Domain words come from `GLOSSARY.md`; design decisions are in `docs/adr/`. The spec is issue #2.

## Layout

| Path | What lives there |
|---|---|
| `src/shared/types.ts` | Every cross-module contract: Probe and Target ids, `Result`, `POST /run` request and response, the JSON `Report`. Change these only on purpose: Probes, Collector, dashboard and the Lab all depend on them. |
| `src/shared/config.ts` | The one config file's type, loader and validation. |
| `src/diagnosis/` | The pure Diagnosis module: test planning, rules, Evidence Levels, Thai explanations, report building. No I/O, no clock reads: `now` is a parameter. |
| `src/probe/` | The Probe test runner and its HTTP server. |
| `src/collector/` | Round orchestration, the ProbeClient port and its HTTP adapter, the Result store, the scheduler and the HTTP API. |
| `src/dashboard/` | The static dashboard page the Collector serves. |
| `lab/` | Docker Compose Lab, the `lab` CLI, Fault mechanisms and the experiment runner. |
| `test/` | Tests, grouped by seam. Shared test helpers live in `test/support/`. |

## Conventions

- ES modules. Relative imports carry the `.ts` extension; `tsc` rewrites them on build.
- No runtime dependencies: Node's standard library only (`http`, `https`, `net`, `dns`, `fs`). Dev dependencies are fine.
- Identifiers, JSON keys and log lines are English. Everything a user reads on the dashboard or in a Finding is Thai, carried over verbatim from the prototype where it exists.
- Use the domain names: Probe (not agent), Collector (not server), Target, Round, Result, Follow-up Test, Finding, Observation, Fault, Scenario.
- Time: the Collector stamps `started_at`/`finished_at` (ADR 0003). Probes measure only `duration_ms` with `performance.now()`.
- Round ids are numbers and are always ordered numerically.
- Inject what varies (clock, ProbeClient, file paths, ports) through parameters, never through module-level globals, so the seams below stay testable.
- `strict` TypeScript; avoid `as` casts except at a parse boundary that has just validated the value.

## Tests

Test external behaviour at the agreed seams only. Assert on Diagnosis output, HTTP responses and Results; never on internal helpers or intermediate Path State tables.

1. **Collector in-process** (`test/collector/`): drive `runRound()` and the Collector's HTTP API with a simulated ProbeClient that ports the prototype's `Lab.measure` world model (`test/support/`). The prototype's `Lab.EXPECT` table and `runBench` protocol are the oracle.
2. **Probe `POST /run`** (`test/probe/`): start the Probe server and real loopback servers (valid and expired TLS, HTTP 500, closed port, silent socket, unresolvable name) inside the test.
3. **Lab experiment** (`lab experiment`): the acceptance test in Docker. Not part of `npm test`; run it before calling the build done.
   `test/lab/` covers the runner itself without Docker: `experiment()` takes an `ExperimentEnv` with a fake Lab and Collector, and the tests assert on its exit code and the files it writes to `results/`.

Rules:
- Write tests first (`tdd` skill) and keep each one about a behaviour a user or operator would notice.
- Do not sleep to wait for the scheduler or the Stale limit: pass a clock or call the operation directly. Real timeouts (Probe tests) may take real time.
- Tests must not need the network beyond loopback, nor Docker.

## Definition of done

`npm run typecheck`, `npm run lint` and `npm test` pass, and the change is covered at one of the seams above.
