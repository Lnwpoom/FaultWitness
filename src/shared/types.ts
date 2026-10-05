// The contracts every module shares: the Result shape, the Probe `POST /run` messages,
// and the JSON report the Collector serves. Vocabulary follows GLOSSARY.md.

export const PROBE_IDS = ['A', 'B'] as const;
export type ProbeId = (typeof PROBE_IDS)[number];

export const EXTERNAL_SITES = ['site-x', 'site-y'] as const;
export type ExternalSiteId = (typeof EXTERNAL_SITES)[number];

export const TARGET_IDS = ['local-service', ...EXTERNAL_SITES] as const;
export type TargetId = (typeof TARGET_IDS)[number];

export const TEST_KINDS = ['http', 'dns', 'tcp'] as const;
export type TestKind = (typeof TEST_KINDS)[number];

export const ERROR_TYPES = ['timeout', 'refused', 'dns_timeout', 'dns_error', 'tls_cert', 'http_status'] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];

/** One test from one Probe to one Target in one Round. Times are stamped by the Collector (ADR 0003). */
export interface Result {
  round_id: number;
  probe_id: ProbeId;
  target: TargetId;
  test: TestKind;
  success: boolean;
  duration_ms: number;
  error_type: ErrorType | null;
  /** epoch ms, Collector clock */
  started_at: number;
  /** epoch ms, Collector clock */
  finished_at: number;
}

export interface TestRequest {
  target: TargetId;
  test: TestKind;
}

/** A test the Collector plans for a specific Probe. */
export interface PlannedTest extends TestRequest {
  probe: ProbeId;
}

/** Body of the Probe's `POST /run`. */
export interface RunRequest {
  round_id: number;
  tests: TestRequest[];
}

/** What a Probe measures for one test: everything in a Result except what the Collector adds. */
export interface ProbeResult {
  target: TargetId;
  test: TestKind;
  success: boolean;
  duration_ms: number;
  error_type: ErrorType | null;
}

/** Response of the Probe's `POST /run`. */
export interface RunResponse {
  probe_id: ProbeId;
  results: ProbeResult[];
}

/** Response of the Probe's `GET /health`. */
export interface HealthResponse {
  probe_id: ProbeId;
}

// ---- the Collector's JSON report (`GET /report`, `POST /rounds`) ----

export type FindingCode = 'normal' | 'probe' | 'dns' | 'shared' | 'dest' | 'insufficient' | 'nodata';
export type EvidenceLevel = 'initial' | 'repeated' | 'confirmed';
/** reported = sent Results in the latest Round; silent = did not, but was seen recently; lost = nothing within the Stale limit */
export type ProbeState = 'reported' | 'silent' | 'lost';

export interface ReportFinding {
  /** Diagnosis key used for scoring, e.g. `dns|A`, `dest|site-x`, `shared`, `insufficient` */
  key: string;
  code: Exclude<FindingCode, 'normal'>;
  status: string;
  title: string;
  evidence_level: EvidenceLevel;
  evidence_level_label: string;
  rounds_seen: number;
  supporting: string[];
  missing: string[];
  next_steps: string[];
}

export interface ReportObservation {
  probe_id: ProbeId;
  peer: ProbeId;
  ratio: number;
  text: string;
  next_steps: string[];
}

export interface ReportProbe {
  probe_id: ProbeId;
  state: ProbeState;
  state_label: string;
  /** epoch ms of the Probe's latest Result, or null if it never reported */
  last_seen_ms: number | null;
}

export interface Report {
  tool: 'FaultWitness';
  round_id: number;
  /** epoch ms when the latest Round finished */
  finished_at: number;
  /** epoch ms when this report was produced */
  generated_at: number;
  stale: boolean;
  overall: string;
  alert: boolean;
  /** sorted Diagnosis keys of the latest Round's Findings; empty means normal */
  keys: string[];
  findings: ReportFinding[];
  observations: ReportObservation[];
  probes: ReportProbe[];
  tests_this_round: number;
  tests_if_full_sweep: number;
  results: Result[];
}

export interface NoDataReport {
  status: 'no-data';
}
