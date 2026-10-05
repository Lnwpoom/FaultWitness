// A simulated pair of Probes, ported from the prototype's `Lab.measure` world model
// (prototypes/network-projects/PROTOTYPE-faultwitness.html). It knows which Faults are
// active; the Collector never does, it only sees the answers.

import type { ProbeClient } from '../../src/collector/index.ts';
import type { ErrorType, ProbeId, ProbeResult, RunResponse, TargetId, TestKind, TestRequest } from '../../src/shared/types.ts';

export const FAULT_NAMES = [
  'dnsA',
  'dnsB',
  'routeA',
  'localDown',
  'siteXDown',
  'certX',
  'egress',
  'clockA',
  'slowA',
  'blipA',
  'cutA',
] as const;
export type FaultName = (typeof FAULT_NAMES)[number];

/** Ground truth per Fault (the prototype's `Lab.EXPECT`); `slowA` expects no Finding. */
export const EXPECT: Partial<Record<FaultName, string>> = {
  dnsA: 'dns|A',
  dnsB: 'dns|B',
  routeA: 'probe|A',
  clockA: 'probe|A',
  blipA: 'probe|A',
  localDown: 'dest|local-service',
  siteXDown: 'dest|site-x',
  certX: 'dest|site-x',
  egress: 'shared',
  cutA: 'insufficient',
};

/** The sorted Diagnosis keys a set of active Faults should produce. */
export function expectedKeys(faults: Iterable<FaultName>): string[] {
  const keys = new Set<string>();
  for (const f of faults) {
    const k = EXPECT[f];
    if (k !== undefined) keys.add(k);
  }
  return [...keys].sort();
}

export type Verdict = 'correct' | 'wrong' | 'insufficient';

/** The prototype's `Lab.score`: exact match, else Insufficient Data if said, else wrong. */
export function score(expected: readonly string[], said: readonly string[]): Verdict {
  if (expected.join() === said.join()) return 'correct';
  return said.includes('insufficient') ? 'insufficient' : 'wrong';
}

const BASE: Record<TargetId, number> = { 'local-service': 18, 'site-x': 120, 'site-y': 180 };
const TCP_MS: Record<TargetId, number> = { 'local-service': 0, 'site-x': 40, 'site-y': 60 };

interface Outcome {
  success: boolean;
  ms: number;
  err: ErrorType | null;
}

/** `Lab.measure`: what one test would return given the active Faults. `seq` drives the jitter. */
export function measure(f: ReadonlySet<FaultName>, probe: ProbeId, target: TargetId, test: TestKind, seq: number): Outcome {
  const jit = (seq * 7 + (probe === 'A' ? 0 : 3) + target.length * 5) % 9;
  const slow = probe === 'A' && f.has('slowA') ? 8 : 1;
  const ok = (ms: number): Outcome => ({ success: true, ms: Math.round(ms * slow) + jit, err: null });
  const no = (err: ErrorType | null, ms: number): Outcome => ({ success: false, ms, err });
  const dnsDown = (probe === 'A' && f.has('dnsA')) || (probe === 'B' && f.has('dnsB'));
  const tcpErr: ErrorType | null = f.has('egress') ? 'timeout' : target === 'site-x' && f.has('siteXDown') ? 'refused' : null;
  const tcpFail = () => no(tcpErr, tcpErr === 'timeout' ? 3000 : 3);
  if (target === 'local-service') {
    if (f.has('localDown')) return no('refused', 2);
    if (probe === 'A' && (f.has('routeA') || f.has('blipA'))) return no('timeout', 3000);
    return ok(BASE[target]);
  }
  if (test === 'dns') return dnsDown ? no('dns_timeout', 2000) : ok(25);
  if (test === 'tcp') return tcpErr ? tcpFail() : ok(TCP_MS[target]);
  // HTTPS by hostname, never rewritten to an IP
  if (dnsDown) return no('dns_error', 2000);
  if (tcpErr) return tcpFail();
  if ((target === 'site-x' && f.has('certX')) || (probe === 'A' && f.has('clockA'))) return no('tls_cert', 90);
  return ok(BASE[target]);
}

/** What Probe A's skewed clock reads under `clockA` (the Lab sets it to 2019-01-01). */
export const SKEWED_PROBE_CLOCK = Date.UTC(2019, 0, 1);

export interface SimulatedProbes extends ProbeClient {
  /** the active Faults; mutate to create or clear them */
  readonly faults: Set<FaultName>;
}

/**
 * A ProbeClient backed by `measure`. `cutA` makes Probe A unreachable (null). Under `clockA`
 * Probe A also stamps its own (skewed) times on each Result, as a misbehaving Probe might;
 * the Collector must ignore them (ADR 0003).
 */
export function createSimulatedProbes(faults: Set<FaultName> = new Set()): SimulatedProbes {
  return {
    faults,
    async run(probeId: ProbeId, roundId: number, tests: TestRequest[]): Promise<RunResponse | null> {
      if (probeId === 'A' && faults.has('cutA')) return null;
      const results: ProbeResult[] = [];
      for (const t of tests) {
        const m = measure(faults, probeId, t.target, t.test, roundId);
        const result = { target: t.target, test: t.test, success: m.success, duration_ms: m.ms, error_type: m.err };
        if (probeId === 'A' && faults.has('clockA')) {
          const stamped = { ...result, started_at: SKEWED_PROBE_CLOCK, finished_at: SKEWED_PROBE_CLOCK + m.ms };
          results.push(stamped);
        } else {
          results.push(result);
        }
      }
      return { probe_id: probeId, results };
    },
  };
}
