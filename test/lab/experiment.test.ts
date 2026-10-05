// `lab experiment` against a fake Lab and Collector: when it writes results/ and when it refuses to.
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { experiment, type ExperimentEnv } from '../../lab/experiment.ts';
import type { Report } from '../../src/shared/types.ts';

function fakeEnv(overrides: Partial<ExperimentEnv> = {}): ExperimentEnv & { outDir: string } {
  const outDir = mkdtempSync(join(tmpdir(), 'fw-experiment-'));
  const refused = () => Promise.reject(new Error('fetch failed'));
  return {
    outDir,
    cadenceMs: 50,
    dockerUp: () => false,
    getReport: refused,
    resetCollector: refused,
    setPaused: refused,
    clearAll: () => Promise.reject(new Error('Cannot connect to the Docker daemon')),
    applyFault: () => Promise.reject(new Error('Cannot connect to the Docker daemon')),
    netemAvailable: () => false,
    ...overrides,
  };
}

/** A Collector whose every GET /report shows a newer, normal Round. */
function normalRounds(): () => Promise<Report> {
  let round = 0;
  return () => {
    round += 1;
    const at = Date.now();
    return Promise.resolve({
      tool: 'FaultWitness', round_id: round, finished_at: at, generated_at: at, stale: false, overall: 'ปกติ',
      alert: false, keys: [], findings: [], observations: [], probes: [], tests_this_round: 6, tests_if_full_sweep: 14,
      results: [{
        round_id: round, probe_id: 'A', target: 'site-x', test: 'http', success: true, duration_ms: 12,
        error_type: null, started_at: at, finished_at: at,
      }],
    });
  };
}

function captureErrors(): () => string {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return () => spy.mock.calls.map((c) => c.join(' ')).join('\n');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lab experiment', () => {
  it('stops before writing anything when Docker is not running', async () => {
    const errors = captureErrors();
    const env = fakeEnv();

    const code = await experiment(['--scenario', 'slowA'], env);

    expect(code).toBe(1);
    expect(readdirSync(env.outDir)).toEqual([]);
    expect(errors()).toContain('Docker Desktop');
    expect(errors()).toContain('npm run lab -- up');
  });

  it('writes no results when it stops before measuring a single Round', async () => {
    const errors = captureErrors();
    const env = fakeEnv({
      dockerUp: () => true,
      getReport: () => Promise.resolve({ status: 'no-data' }),
      resetCollector: () => Promise.resolve({}),
      setPaused: () => Promise.resolve({}),
    });

    const code = await experiment(['--scenario', 'dnsA'], env);

    expect(code).toBe(1);
    expect(readdirSync(env.outDir)).toEqual([]);
    expect(errors()).toContain('Cannot connect to the Docker daemon');
  });

  it('writes the tables and every Result when Rounds were measured', async () => {
    captureErrors();
    const env = fakeEnv({
      dockerUp: () => true,
      getReport: normalRounds(),
      resetCollector: () => Promise.resolve({}),
      setPaused: () => Promise.resolve({}),
      clearAll: () => Promise.resolve(),
    });

    const code = await experiment(['--scenario', 'normal'], env);

    expect(code).toBe(0);
    const files = readdirSync(env.outDir).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^experiment-.*\.jsonl$/);
    expect(files[1]).toMatch(/^experiment-.*\.md$/);
    expect(readFileSync(join(env.outDir, files[1]!), 'utf8')).toContain('วัดใน Docker Lab จริง 5 รอบ');
    expect(readFileSync(join(env.outDir, files[0]!), 'utf8').trim().split('\n')).toHaveLength(5);
  });
});
