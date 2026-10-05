// The adaptive test plan: HTTP everywhere, then Follow-up Tests only where HTTP failed.

import { EXTERNAL_SITES, PROBE_IDS, TARGET_IDS, type PlannedTest, type Result } from '../shared/types.ts';

/** Tests a Full Sweep would run on one Probe: HTTP to the Internal Service plus HTTP, DNS and TCP per External Site. */
export const FULL_SWEEP_PER_PROBE = 1 + EXTERNAL_SITES.length * 3;

/** The HTTP test for every Probe and every Target. */
export function planHttp(): PlannedTest[] {
  return PROBE_IDS.flatMap((probe) => TARGET_IDS.map((target) => ({ probe, target, test: 'http' as const })));
}

/**
 * DNS and TCP Follow-up Tests for each External Site whose HTTP failed on any Probe, planned on
 * every Probe that reported: the other Probe is the comparison evidence.
 */
export function planFollowUps(httpResults: readonly Pick<Result, 'probe_id' | 'target' | 'success'>[]): PlannedTest[] {
  const failed = EXTERNAL_SITES.filter((t) => httpResults.some((r) => r.target === t && !r.success));
  const probes = PROBE_IDS.filter((p) => httpResults.some((r) => r.probe_id === p));
  return probes.flatMap((probe) =>
    failed.flatMap((target) => [
      { probe, target, test: 'dns' as const },
      { probe, target, test: 'tcp' as const },
    ]),
  );
}
