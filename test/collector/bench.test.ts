// The prototype's runBench main table: 5 Scenarios × 5 Rounds. For a Fault Scenario: reset,
// 2 normal Rounds, apply the Fault, observe 5 Rounds. Expected figures are the prototype's.

import { describe, expect, it } from 'vitest';
import { createSimLab } from '../support/sim-lab.ts';
import { expectedKeys, score, type FaultName } from '../support/simulated-probes.ts';

interface Row {
  verdicts: string[];
  falseAlarms: number;
  /** 1-based Round of the first correct report with an alert, or null */
  detectedAt: number | null;
  avgTests: number;
  full: number;
  levels: string[];
}

async function bench(faults: FaultName[]): Promise<Row> {
  const lab = createSimLab();
  if (faults.length) {
    await lab.rounds(2);
    for (const f of faults) lab.faults.add(f);
  }
  const reports = await lab.rounds(5);
  const exp = expectedKeys(faults);
  const verdicts = reports.map((r) => score(exp, r.keys));
  const detected = reports.findIndex((r, i) => exp.length > 0 && verdicts[i] === 'correct' && r.alert);
  return {
    verdicts,
    falseAlarms: reports.filter((r) => exp.length === 0 && r.alert).length,
    detectedAt: detected === -1 ? null : detected + 1,
    avgTests: reports.reduce((a, r) => a + r.tests_this_round, 0) / reports.length,
    full: reports[0]?.tests_if_full_sweep ?? 0,
    levels: reports.map((r) => r.findings.map((f) => f.evidence_level_label).join('+') || 'ปกติ'),
  };
}

const ALL_CORRECT = ['correct', 'correct', 'correct', 'correct', 'correct'];
const firstThenConfirmed = ['เบื้องต้น', 'ยืนยันจากหลายจุด', 'ยืนยันจากหลายจุด', 'ยืนยันจากหลายจุด', 'ยืนยันจากหลายจุด'];

describe('runBench main table (5 Scenarios × 5 Rounds)', () => {
  it.each<[string, FaultName[], Row]>([
    ['ปกติ', [], { verdicts: ALL_CORRECT, falseAlarms: 0, detectedAt: null, avgTests: 6, full: 14, levels: Array(5).fill('ปกติ') }],
    ['DNS ของ A เสีย', ['dnsA'], { verdicts: ALL_CORRECT, falseAlarms: 0, detectedAt: 2, avgTests: 14, full: 14, levels: firstThenConfirmed }],
    ['ปลายทางหนึ่งเสีย', ['siteXDown'], { verdicts: ALL_CORRECT, falseAlarms: 0, detectedAt: 2, avgTests: 10, full: 14, levels: firstThenConfirmed }],
    ['เส้นทางของ A มีปัญหา', ['routeA'], { verdicts: ALL_CORRECT, falseAlarms: 0, detectedAt: 2, avgTests: 6, full: 14, levels: firstThenConfirmed }],
    ['เส้นทางออกภายนอกร่วมเสีย', ['egress'], { verdicts: ALL_CORRECT, falseAlarms: 0, detectedAt: 2, avgTests: 14, full: 14, levels: firstThenConfirmed }],
  ])('%s', async (_name, faults, row) => {
    expect(await bench(faults)).toEqual(row);
  });
});
