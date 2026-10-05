// Round orchestration: HTTP tests on both Probes, Follow-up Tests where HTTP failed, then the
// Diagnosis. No transport and no scheduling here; those wrap this from the outside.

import { DEFAULT_STALE_AFTER_MS, diagnose, planFollowUps, planHttp, toReport } from '../diagnosis/index.ts';
import { PROBE_IDS, type PlannedTest, type ProbeId, type Report, type Result } from '../shared/types.ts';
import type { Clock, ProbeClient } from './ports.ts';
import type { ResultStore } from './result-store.ts';

export interface CollectorOptions {
  client: ProbeClient;
  store: ResultStore;
  clock: Clock;
  /** Stale limit in ms (config `stale_after_ms`); defaults to 25000 */
  staleAfterMs?: number;
}

export interface Collector {
  /**
   * Runs one Round and returns the report that follows it, or null if nothing has ever been
   * stored (both Probes silent on the very first Round).
   */
  runRound(): Promise<Report | null>;
  /** The report for the stored Results as of now, or null when there are none. */
  report(): Report | null;
  /** Forgets every stored Result (the JSONL keeps them, after a reset marker). Round ids keep counting. */
  reset(): void;
}

export function createCollector({ client, store, clock, staleAfterMs = DEFAULT_STALE_AFTER_MS }: CollectorOptions): Collector {
  let lastRoundId = store.all().reduce((m, r) => Math.max(m, r.round_id), 0);

  // ADR 0003: times come from the Collector's clock. started_at is read just before the Probe is
  // called and finished_at just after its answer arrives, so every Result of one call shares
  // them; the Probe's own clock (and any times it sends) is ignored.
  async function call(probeId: ProbeId, roundId: number, plan: readonly PlannedTest[]): Promise<Result[] | null> {
    const tests = plan.filter((t) => t.probe === probeId).map(({ target, test }) => ({ target, test }));
    const started_at = clock.now();
    const answer = await client.run(probeId, roundId, tests);
    const finished_at = clock.now();
    if (!answer || answer.probe_id !== probeId) return null;
    return answer.results.map((r) => ({
      round_id: roundId,
      probe_id: probeId,
      target: r.target,
      test: r.test,
      success: r.success,
      duration_ms: r.duration_ms,
      error_type: r.error_type,
      started_at,
      finished_at,
    }));
  }

  function report(): Report | null {
    const now = clock.now();
    const d = diagnose(store.all(), now, { staleAfterMs });
    return d ? toReport(d, now) : null;
  }

  async function runRound(): Promise<Report | null> {
    const roundId = ++lastRoundId;
    const httpPlan = planHttp();
    const first = await Promise.all(PROBE_IDS.map((p) => call(p, roundId, httpPlan)));
    const http = first.flatMap((rs) => rs ?? []);
    const followUps = planFollowUps(http);
    // Only Probes that answered the HTTP call are asked again; one with nothing to do is not called.
    const again = PROBE_IDS.filter((p, i) => first[i] !== null && followUps.some((t) => t.probe === p));
    const second = await Promise.all(again.map((p) => call(p, roundId, followUps)));
    // The whole Round is stored at once, so a report read mid-Round never sees half of it.
    store.append([...http, ...second.flatMap((rs) => rs ?? [])]);
    return report();
  }

  return { runRound, report, reset: () => store.reset() };
}
