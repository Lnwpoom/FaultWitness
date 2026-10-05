// A Collector wired to simulated Probes, a manual clock and a temporary JSONL file:
// the in-process stand-in for the Lab used by the Seam 1 tests.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCollector, createResultStore, type Collector, type ProbeClient, type ResultStore } from '../../src/collector/index.ts';
import type { Report } from '../../src/shared/types.ts';
import { createSimulatedProbes, type FaultName } from './simulated-probes.ts';

export const CADENCE_MS = 10_000;

export interface ManualClock {
  now(): number;
  advance(ms: number): void;
}

export function manualClock(start = Date.UTC(2026, 9, 5, 9, 0, 0)): ManualClock {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

export interface SimLab {
  clock: ManualClock;
  faults: Set<FaultName>;
  store: ResultStore;
  collector: Collector;
  jsonlPath: string;
  /** Waits one cadence, runs a Round, then clears `blipA` (it lasts exactly one Round). */
  round(): Promise<Report>;
  /** Runs `n` Rounds and returns their reports in order. */
  rounds(n: number): Promise<Report[]>;
}

export function tempJsonlPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'fw-collector-')), 'results.jsonl');
}

export function createSimLab(opts: { client?: ProbeClient; staleAfterMs?: number } = {}): SimLab {
  const clock = manualClock();
  const sim = createSimulatedProbes();
  const jsonlPath = tempJsonlPath();
  const store = createResultStore({ path: jsonlPath, clock });
  const collector = createCollector({ client: opts.client ?? sim, store, clock, staleAfterMs: opts.staleAfterMs });
  const round = async () => {
    clock.advance(CADENCE_MS);
    const report = await collector.runRound();
    sim.faults.delete('blipA');
    if (!report) throw new Error('sim-lab: the Round produced no report');
    return report;
  };
  const rounds = async (n: number) => {
    const out: Report[] = [];
    for (let i = 0; i < n; i++) out.push(await round());
    return out;
  };
  return { clock, faults: sim.faults, store, collector, jsonlPath, round, rounds };
}

/** The runBench protocol: two normal Rounds, then the Faults, then `observe` Rounds. */
export async function observeFaults(
  faults: readonly FaultName[],
  observe: number,
  opts: Parameters<typeof createSimLab>[0] = {},
): Promise<{ lab: SimLab; reports: Report[] }> {
  const lab = createSimLab(opts);
  await lab.rounds(2);
  for (const f of faults) lab.faults.add(f);
  return { lab, reports: await lab.rounds(observe) };
}
