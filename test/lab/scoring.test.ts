// Scoring for `lab experiment`, against recorded report shapes.
import { describe, expect, it } from 'vitest';
import { renderMarkdown, scoreRound, summarize, type ObservedRound, type ScenarioPlan } from '../../lab/scoring.ts';
import type { ReportFinding, ReportObservation } from '../../src/shared/types.ts';

const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);

function finding(key: string, level: ReportFinding['evidence_level'] = 'initial'): ReportFinding {
  const labels = { initial: 'เบื้องต้น', repeated: 'พบซ้ำ', confirmed: 'ยืนยันจากหลายจุด' };
  return {
    key, code: 'dns', status: '', title: '', evidence_level: level, evidence_level_label: labels[level],
    rounds_seen: 1, supporting: [], missing: [], next_steps: [],
  };
}

function round(
  keys: string[],
  opts: { alert?: boolean; expected?: string[]; active?: boolean; at?: number; obs?: ReportObservation[]; expectObservation?: 'A'; level?: ReportFinding['evidence_level']; tests?: number } = {},
): ObservedRound {
  return {
    report: {
      round_id: 1, finished_at: opts.at ?? T0, keys, alert: opts.alert ?? false,
      findings: keys.map((k) => finding(k, opts.level)), observations: opts.obs ?? [],
      tests_this_round: opts.tests ?? 6, tests_if_full_sweep: 14,
    },
    expected: opts.expected ?? [],
    faultActive: opts.active ?? false,
    ...(opts.expectObservation ? { expectObservation: opts.expectObservation } : {}),
  };
}

const slowObs: ReportObservation = { probe_id: 'A', peer: 'B', ratio: 8, text: '', next_steps: [] };

describe('scoreRound', () => {
  it('is correct only on an exact key match', () => {
    expect(scoreRound(round(['dns|A'], { expected: ['dns|A'], active: true })).verdict).toBe('correct');
    expect(scoreRound(round([], { expected: [] })).verdict).toBe('correct');
    expect(scoreRound(round(['dns|A', 'probe|A'], { expected: ['dns|A'], active: true })).verdict).toBe('wrong');
    expect(scoreRound(round([], { expected: ['shared'], active: true })).verdict).toBe('wrong');
  });

  it('counts a Diagnosis containing Insufficient Data as such, unless that was expected', () => {
    expect(scoreRound(round(['insufficient'], { expected: ['dns|A'], active: true })).verdict).toBe('insufficient');
    expect(scoreRound(round(['dns|A', 'insufficient'], { expected: ['dns|A'], active: true })).verdict).toBe('insufficient');
    expect(scoreRound(round(['insufficient'], { expected: ['insufficient'], active: true })).verdict).toBe('correct');
  });

  it('flags an alert with no Fault active as a false alarm', () => {
    expect(scoreRound(round(['probe|A'], { alert: true })).falseAlarm).toBe(true);
    expect(scoreRound(round(['probe|A'], { alert: true, expected: ['probe|A'], active: true })).falseAlarm).toBe(false);
    expect(scoreRound(round([], {})).falseAlarm).toBe(false);
  });

  it('requires the Observation naming A for slowA', () => {
    const base = { expected: [], active: true, expectObservation: 'A' as const };
    expect(scoreRound(round([], base)).verdict).toBe('wrong');
    expect(scoreRound(round([], { ...base, obs: [slowObs] })).verdict).toBe('correct');
    expect(scoreRound(round([], { ...base, obs: [{ ...slowObs, probe_id: 'B' }] })).verdict).toBe('wrong');
  });
});

describe('summarize', () => {
  const dnsA: ScenarioPlan = { id: 'dnsA', name: 'DNS ของ A เสีย', expected: ['dns|A'], expectAlert: true };
  const on = { expected: ['dns|A'], active: true };

  it('measures detection from wall-clock time to the first correct Round with an alert', () => {
    const row = summarize({
      plan: dnsA,
      appliedAt: T0,
      rounds: [
        round(['dns|A'], { ...on, at: T0 + 12_400 }),
        round(['dns|A'], { ...on, alert: true, at: T0 + 22_600, level: 'confirmed', tests: 14 }),
        round(['dns|A'], { ...on, alert: true, at: T0 + 32_500, level: 'confirmed' }),
        round(['dns|A'], { ...on, alert: true, at: T0 + 42_500, level: 'confirmed' }),
        round(['dns|A'], { ...on, alert: true, at: T0 + 52_500, level: 'confirmed' }),
      ],
    });
    expect(row).toMatchObject({ correct: 5, wrong: 0, insufficient: 0, falseAlarms: 0, detection: { seconds: 23, round: 2 } });
    expect(row.detectionText).toBe('23 วิ (รอบที่ 2)');
    expect(row.avgTests).toBeCloseTo(7.6);
    expect(row.levels).toBe('เบื้องต้น → ยืนยันจากหลายจุด → ยืนยันจากหลายจุด → ยืนยันจากหลายจุด → ยืนยันจากหลายจุด');
  });

  it('says so when a Fault never raised the alert', () => {
    const row = summarize({ plan: dnsA, appliedAt: T0, rounds: [round(['dns|A'], on)] });
    expect(row.detection).toBeNull();
    expect(row.detectionText).toBe('ไม่แจ้งเตือน');
  });

  it('shows a Scenario that could not run as not run, with the reason', () => {
    const slowA: ScenarioPlan = { id: 'slowA', name: 'เครื่อง A ช้า', expected: [], expectObservation: 'A', expectAlert: false };
    const row = summarize({ plan: slowA, notRun: 'netem ไม่มี', appliedAt: null, rounds: [] });
    expect(row).toMatchObject({ notRun: 'netem ไม่มี', correct: 0, rounds: 0 });
    const md = renderMarkdown({
      startedAt: new Date(T0), finishedAt: new Date(T0 + 60_000), cadenceMs: 10_000, main: [],
      extended: [{ plan: slowA, notRun: 'netem ไม่มี', appliedAt: null, rounds: [] }],
    });
    expect(md).toContain('| เครื่อง A ช้า | ปกติ + ข้อสังเกต A ช้า | ไม่ได้รัน |');
    expect(md).toContain('netem ไม่มี');
  });

  it('writes the measured-in-the-Lab line and totals', () => {
    const normal: ScenarioPlan = { id: 'normal', name: 'ปกติ', expected: [], expectAlert: false };
    const md = renderMarkdown({
      startedAt: new Date(T0), finishedAt: new Date(T0 + 60_000), cadenceMs: 10_000,
      main: [{ plan: normal, appliedAt: null, rounds: [round([]), round([]), round(['probe|A'], { alert: true })] }],
      extended: [],
    });
    expect(md).toContain('วัดใน Docker Lab จริง 3 รอบ · 2026-10-05 09:00 UTC');
    expect(md).toContain('| ปกติ | ปกติ | 2/3 | 1 | 0 | 1 | — |');
    expect(md).toContain('| **รวม** | | **2/3** | **1** | **0** | **1** |');
  });
});
