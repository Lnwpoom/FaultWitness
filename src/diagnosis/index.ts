// The pure Diagnosis module: test planning, rules, Evidence Levels, Thai explanations and the
// JSON report. No I/O and no clock reads: `now` is always a parameter.

export { planHttp, planFollowUps, FULL_SWEEP_PER_PROBE } from './plan.ts';
export {
  diagnose,
  DEFAULT_STALE_AFTER_MS,
  MAX_ROUNDS,
  type Diagnosis,
  type DiagnoseOptions,
  type Finding,
  type Observation,
  type ProbeInfo,
} from './diagnose.ts';
export { toReport } from './report.ts';
export { ERR, LEVEL, PROBE_STATE, STATUS, TN } from './labels.ts';
