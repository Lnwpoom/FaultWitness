// Scoring for `lab experiment`: each Round's Diagnosis against the ground truth of the Faults
// that were active during it, and the slide tables (the prototype's runBench columns).
// Pure: no Docker, no clock.
import type { Report } from '../src/shared/types.ts';

export type Verdict = 'correct' | 'wrong' | 'insufficient';

/** One observed Round with the ground truth the tester knows and the Collector does not. */
export interface ObservedRound {
  report: Pick<Report, 'round_id' | 'finished_at' | 'keys' | 'alert' | 'findings' | 'observations' | 'tests_this_round' | 'tests_if_full_sweep'>;
  /** Diagnosis keys expected for this Round (from the Fault table); [] = normal */
  expected: string[];
  /** a Fault was active while this Round ran */
  faultActive: boolean;
  /** the Diagnosis must also carry an Observation naming this Probe (slowA) */
  expectObservation?: 'A' | 'B';
}

export interface Score {
  verdict: Verdict;
  falseAlarm: boolean;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Prototype `Lab.score`, plus the Observation rule for slowA. */
export function scoreRound(r: ObservedRound): Score {
  const said = [...r.report.keys].sort();
  const expected = [...r.expected].sort();
  const observed = r.expectObservation === undefined || r.report.observations.some((o) => o.probe_id === r.expectObservation);
  const verdict: Verdict = same(said, expected) && observed ? 'correct' : said.includes('insufficient') ? 'insufficient' : 'wrong';
  return { verdict, falseAlarm: !r.faultActive && r.report.alert };
}

export interface ScenarioPlan {
  /** `normal` or a Fault name */
  id: string;
  /** Thai name for the table */
  name: string;
  /** expected keys while the Fault is active (the "คาดหวัง" column) */
  expected: string[];
  expectObservation?: 'A' | 'B';
  /** whether a correct Diagnosis of this Fault should raise the alert (false for normal, slowA, blipA) */
  expectAlert: boolean;
}

export interface ScenarioRun {
  plan: ScenarioPlan;
  /** set when the Scenario could not run */
  notRun?: string;
  /** epoch ms when the Fault was applied; null for normal */
  appliedAt: number | null;
  /** the observed Rounds (5), after the 2 normal warm-up Rounds */
  rounds: ObservedRound[];
}

export interface ScenarioRow {
  name: string;
  expected: string;
  notRun?: string;
  rounds: number;
  correct: number;
  wrong: number;
  insufficient: number;
  falseAlarms: number;
  /** seconds from applying the Fault to the first correct report with an alert, and that Round's number (1-based) */
  detection: { seconds: number; round: number } | null;
  detectionText: string;
  avgTests: number;
  fullSweep: number;
  levels: string;
}

const KEY_LABEL: Record<string, string> = { 'local-service': 'บริการภายใน', 'site-x': 'เว็บไซต์ X', 'site-y': 'เว็บไซต์ Y' };

/** Prototype `keyLabel`/`keysLabel`: Thai names for Diagnosis keys. */
export function keysLabel(keys: readonly string[]): string {
  if (!keys.length) return 'ปกติ';
  return keys
    .map((k) => {
      const [code, arg] = k.split('|');
      if (code === 'insufficient') return 'ข้อมูลไม่พอ';
      if (code === 'shared') return 'ภายนอกร่วมเสีย';
      if (code === 'dns') return `DNS ของ ${arg}`;
      if (code === 'probe') return `เฉพาะจุด ${arg}`;
      return `ปลายทาง: ${KEY_LABEL[arg ?? ''] ?? arg}`;
    })
    .join(' + ');
}

export function summarize(run: ScenarioRun): ScenarioRow {
  const { plan, rounds } = run;
  const expected = keysLabel(plan.expected) + (plan.expectObservation ? ` + ข้อสังเกต ${plan.expectObservation} ช้า` : '');
  const empty = { correct: 0, wrong: 0, insufficient: 0, falseAlarms: 0, detection: null, avgTests: 0, fullSweep: 0, levels: '' };
  if (run.notRun !== undefined) {
    return { name: plan.name, expected, notRun: run.notRun, rounds: 0, ...empty, detectionText: 'ไม่ได้รัน' };
  }
  const scores = rounds.map(scoreRound);
  const count = (v: Verdict) => scores.filter((s) => s.verdict === v).length;
  const detectAt = plan.expectAlert ? scores.findIndex((s, i) => s.verdict === 'correct' && rounds[i]!.report.alert) : -1;
  const detection =
    detectAt >= 0 && run.appliedAt !== null
      ? { seconds: Math.round((rounds[detectAt]!.report.finished_at - run.appliedAt) / 1000), round: detectAt + 1 }
      : null;
  const detectionText = detection
    ? `${detection.seconds} วิ (รอบที่ ${detection.round})`
    : plan.expectAlert
      ? 'ไม่แจ้งเตือน'
      : run.appliedAt === null
        ? '—'
        : '— (ไม่ควรแจ้งเตือน)';
  return {
    name: plan.name,
    expected,
    rounds: rounds.length,
    correct: count('correct'),
    wrong: count('wrong'),
    insufficient: count('insufficient'),
    falseAlarms: scores.filter((s) => s.falseAlarm).length,
    detection,
    detectionText,
    avgTests: rounds.length ? rounds.reduce((a, r) => a + r.report.tests_this_round, 0) / rounds.length : 0,
    fullSweep: rounds[0]?.report.tests_if_full_sweep ?? 0,
    levels: rounds
      .map((r) => r.report.findings.map((f) => f.evidence_level_label).join('+') || 'ปกติ')
      .join(' → '),
  };
}

export interface Totals {
  rounds: number;
  correct: number;
  wrong: number;
  insufficient: number;
  falseAlarms: number;
  tests: number;
  fullSweep: number;
}

export function totals(runs: readonly ScenarioRun[]): Totals {
  const all = runs.flatMap((r) => (r.notRun === undefined ? r.rounds : []));
  const scores = all.map(scoreRound);
  return {
    rounds: all.length,
    correct: scores.filter((s) => s.verdict === 'correct').length,
    wrong: scores.filter((s) => s.verdict === 'wrong').length,
    insufficient: scores.filter((s) => s.verdict === 'insufficient').length,
    falseAlarms: scores.filter((s) => s.falseAlarm).length,
    tests: all.reduce((a, r) => a + r.report.tests_this_round, 0),
    fullSweep: all.reduce((a, r) => a + r.report.tests_if_full_sweep, 0),
  };
}

function table(title: string, runs: readonly ScenarioRun[]): string {
  if (!runs.length) return '';
  const t = totals(runs);
  const lines = [
    `## ${title}`,
    '',
    `รอบทั้งหมด **${t.rounds}** · จำแนกถูก **${t.correct}** · ผิด **${t.wrong}** · ข้อมูลไม่พอ **${t.insufficient}** · แจ้งเตือนผิด **${t.falseAlarms}** · การทดสอบ ตามอาการ / ตรวจทุกอย่าง **${t.tests} / ${t.fullSweep}**`,
    '',
    '| สถานการณ์ | คาดหวัง | ถูก | ผิด | ข้อมูลไม่พอ | แจ้งเตือนผิด | เวลาตรวจพบ (ถึงแจ้งเตือน) | การทดสอบเฉลี่ย/รอบ | ระดับหลักฐานรอบ 1→5 |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const run of runs) {
    const r = summarize(run);
    lines.push(
      r.notRun !== undefined
        ? `| ${r.name} | ${r.expected} | ไม่ได้รัน | | | | | | ${r.notRun} |`
        : `| ${r.name} | ${r.expected} | ${r.correct}/${r.rounds} | ${r.wrong} | ${r.insufficient} | ${r.falseAlarms} | ${r.detectionText} | ${r.avgTests.toFixed(1)} / ${r.fullSweep} | ${r.levels} |`,
    );
  }
  lines.push(
    `| **รวม** | | **${t.correct}/${t.rounds}** | **${t.wrong}** | **${t.insufficient}** | **${t.falseAlarms}** | | **${t.rounds ? (t.tests / t.rounds).toFixed(1) : '0'} / ${t.rounds ? (t.fullSweep / t.rounds).toFixed(1) : '0'}** | |`,
  );
  return lines.join('\n');
}

export interface ExperimentDoc {
  startedAt: Date;
  finishedAt: Date;
  cadenceMs: number;
  main: ScenarioRun[];
  extended: ScenarioRun[];
}

export function renderMarkdown(doc: ExperimentDoc): string {
  const n = totals([...doc.main, ...doc.extended]).rounds;
  const date = doc.startedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const minutes = Math.round((doc.finishedAt.getTime() - doc.startedAt.getTime()) / 60000);
  return [
    '# FaultWitness — ผลการทดลองในห้องแล็บ',
    '',
    `วัดใน Docker Lab จริง ${n} รอบ · ${date} · ใช้เวลา ${minutes} นาที · รอบตรวจทุก ${doc.cadenceMs / 1000} วินาที, แจ้งเตือนเมื่อพบซ้ำ 2 รอบ`,
    '',
    'วิธีทดลอง (เหมือน runBench ของต้นแบบ): ล้างผลใน Collector → ถ้ามีเหตุ ให้ดูรอบปกติ 2 รอบแล้วสร้างเหตุทันทีหลังรอบที่ 2 จบ → ดูผล 5 รอบ → คืนค่า ' +
      'แต่ละรอบเทียบคีย์ของผลวิเคราะห์กับคำตอบที่คาดหวัง: ตรงกันทุกคีย์ = ถูก, มี "ข้อมูลไม่พอ" = ข้อมูลไม่พอ, อื่น ๆ = ผิด; แจ้งเตือนขณะไม่มีเหตุ = แจ้งเตือนผิด. ' +
      'เวลาตรวจพบวัดจากนาฬิกาจริง ตั้งแต่สร้างเหตุถึงรายงานแรกที่ถูกต้องและแจ้งเตือน',
    '',
    table('ตารางหลัก (5 สถานการณ์ × 5 รอบ)', doc.main),
    '',
    table('ตารางขยาย (กรณียาก)', doc.extended),
    '',
  ].join('\n');
}
