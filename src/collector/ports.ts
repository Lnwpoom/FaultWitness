import type { ProbeId, RunResponse, TestRequest } from '../shared/types.ts';

/** The Collector's clock: epoch ms. Injected so tests never sleep. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

/**
 * How the Collector asks a Probe to run tests (ADR 0002: the Collector pulls). The real adapter
 * POSTs a RunRequest to the Probe's `/run`; it resolves null on timeout, refusal or a bad answer,
 * never rejects.
 */
export interface ProbeClient {
  run(probeId: ProbeId, roundId: number, tests: TestRequest[]): Promise<RunResponse | null>;
}
