// The real ProbeClient: POSTs a RunRequest to each Probe's `/run` (ADR 0002). Any failure,
// timeout, refusal or malformed answer resolves null, so a dead Probe never stops a Round.
import { request } from 'node:http';
import type { ProbeConfig } from '../shared/config.ts';
import {
  ERROR_TYPES,
  PROBE_IDS,
  TARGET_IDS,
  TEST_KINDS,
  type ProbeId,
  type ProbeResult,
  type RunRequest,
  type RunResponse,
  type TestRequest,
} from '../shared/types.ts';
import type { ProbeClient } from './ports.ts';

export interface HttpProbeClientOptions {
  probes: Record<ProbeId, ProbeConfig>;
  /** whole-call timeout (config `timeouts.probe_call_ms`) */
  timeoutMs: number;
}

const MAX_BODY = 1 << 20;

function isProbeResult(v: unknown): v is ProbeResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    (TARGET_IDS as readonly unknown[]).includes(r.target) &&
    (TEST_KINDS as readonly unknown[]).includes(r.test) &&
    typeof r.success === 'boolean' &&
    typeof r.duration_ms === 'number' &&
    Number.isFinite(r.duration_ms) &&
    (r.error_type === null || (ERROR_TYPES as readonly unknown[]).includes(r.error_type))
  );
}

/** Validates a Probe's answer; anything off is treated as no answer. */
export function parseRunResponse(body: string): RunResponse | null {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!(PROBE_IDS as readonly unknown[]).includes(o.probe_id)) return null;
  if (!Array.isArray(o.results) || !o.results.every(isProbeResult)) return null;
  return { probe_id: o.probe_id as ProbeId, results: o.results };
}

export function createHttpProbeClient({ probes, timeoutMs }: HttpProbeClientOptions): ProbeClient {
  return {
    run(probeId: ProbeId, roundId: number, tests: TestRequest[]): Promise<RunResponse | null> {
      const body: RunRequest = { round_id: roundId, tests };
      const payload = JSON.stringify(body);
      return new Promise((resolve) => {
        let settled = false;
        const done = (answer: RunResponse | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(answer);
        };
        const req = request(new URL('/run', probes[probeId].url), {
          method: 'POST',
          agent: false,
          headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
        });
        const timer = setTimeout(() => {
          req.destroy();
          done(null);
        }, timeoutMs);
        req.on('response', (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            done(null);
            return;
          }
          let text = '';
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            text += chunk;
            if (text.length > MAX_BODY) req.destroy();
          });
          res.on('end', () => done(parseRunResponse(text)));
          res.on('error', () => done(null));
        });
        req.on('error', () => done(null));
        req.end(payload);
      });
    },
  };
}
