import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ProbeClient } from '../../src/collector/index.ts';
import type { ProbeId, Report, Result } from '../../src/shared/types.ts';
import { createSimLab, observeFaults } from '../support/sim-lab.ts';
import { createSimulatedProbes, type FaultName } from '../support/simulated-probes.ts';

const levels = (r: Report | undefined) => r?.findings.map((f) => f.evidence_level);
const rowsOf = (r: Report | undefined) => (r?.results ?? []).map((x) => `${x.probe_id} ${x.target} ${x.test}`).sort();

describe('Evidence Levels and alerts', () => {
  it('raises a Finding from initial to confirmed when corroborated by the other Probe, alerting only from the second Round', async () => {
    const { reports } = await observeFaults(['dnsA'], 3);
    expect(reports.map(levels)).toEqual([['initial'], ['confirmed'], ['confirmed']]);
    expect(reports.map((r) => r.findings[0]?.rounds_seen)).toEqual([1, 2, 3]);
    expect(reports.map((r) => r.alert)).toEqual([false, true, true]);
    expect(reports[1]?.findings[0]?.evidence_level_label).toBe('ยืนยันจากหลายจุด');
    expect(reports[1]?.findings[0]?.supporting[0]).toBe('A แปลงชื่อ เว็บไซต์ X และ เว็บไซต์ Y ไม่สำเร็จ 2 รอบติดกัน (DNS ไม่ตอบ)');
  });

  it('stops at repeated when no other Probe can corroborate', async () => {
    const { reports } = await observeFaults(['dnsA', 'dnsB'], 2);
    expect(reports.map((r) => r.keys)).toEqual([
      ['dns|A', 'dns|B'],
      ['dns|A', 'dns|B'],
    ]);
    expect(reports.map(levels)).toEqual([
      ['initial', 'initial'],
      ['repeated', 'repeated'],
    ]);
    expect(reports[1]?.findings[0]?.evidence_level_label).toBe('พบซ้ำ');
    expect(reports[1]?.alert).toBe(true);
  });

  it('counts a streak over at most the 20 most recent Rounds', async () => {
    const { reports } = await observeFaults(['dnsA'], 25);
    expect(reports.at(-1)?.findings[0]?.rounds_seen).toBe(20);
  });
});

describe('Stale and silent Probes', () => {
  it('says Insufficient Data when the latest Round is older than the Stale limit', async () => {
    const { lab } = await observeFaults(['dnsA'], 2);
    lab.clock.advance(30_000);
    const report = lab.collector.report();
    expect(report?.stale).toBe(true);
    expect(report?.overall).toBe('ข้อมูลยังไม่พอ');
    expect(report?.alert).toBe(false);
    expect(report?.probes.map((p) => [p.probe_id, p.state, p.state_label])).toEqual([
      ['A', 'lost', 'ขาดการติดต่อ'],
      ['B', 'lost', 'ขาดการติดต่อ'],
    ]);
  });

  it('takes the Stale limit from the Collector options', async () => {
    const { lab } = await observeFaults([], 1, { staleAfterMs: 60_000 });
    lab.clock.advance(30_000);
    expect(lab.collector.report()?.stale).toBe(false);
    lab.clock.advance(31_000);
    expect(lab.collector.report()?.stale).toBe(true);
  });

  it('reports a Probe that stops answering as silent, then lost, with the no-data Finding naming it', async () => {
    const { reports } = await observeFaults(['cutA'], 3);
    const [first, , third] = reports;
    expect(first?.keys).toEqual(['insufficient']);
    expect(first?.probes.map((p) => [p.probe_id, p.state, p.state_label])).toEqual([
      ['A', 'silent', 'ไม่ส่งผลรอบล่าสุด'],
      ['B', 'reported', 'ส่งผลรอบล่าสุด'],
    ]);
    expect(third?.probes.map((p) => p.state)).toEqual(['lost', 'reported']);
    const finding = third?.findings[0];
    expect(finding?.code).toBe('nodata');
    expect(finding?.status).toBe('ข้อมูลยังไม่พอ');
    expect(finding?.title).toBe('ไม่มีผลรอบล่าสุดจาก Probe A');
    expect(finding?.supporting).toEqual([
      'A: ขาดการติดต่อ (ผลล่าสุด 30 วินาทีก่อน) — ไม่นำผลเก่ามาใช้เป็นสถานะปัจจุบัน',
      'B ส่งผลรอบนี้ครบ',
    ]);
    expect(finding?.next_steps).toEqual(['ตรวจว่าเครื่อง A เปิดอยู่และ probe ยังทำงาน', 'ตรวจว่าเครื่องหลักเข้าถึงพอร์ตของ Probe A ได้']);
    expect(third?.tests_this_round).toBe(3);
    expect(third?.tests_if_full_sweep).toBe(7);
  });
});

describe('two simultaneous Faults', () => {
  it.each<[FaultName[], string[]]>([
    [['dnsA', 'siteXDown'], ['dest|site-x', 'dns|A']],
    [['dnsA', 'egress'], ['dns|A', 'shared']],
    [['cutA', 'siteXDown'], ['insufficient']],
  ])('%j is diagnosed as %j', async (faults, keys) => {
    const { reports } = await observeFaults(faults, 2);
    expect(reports.map((r) => r.keys)).toEqual([keys, keys]);
    expect(reports[1]?.alert).toBe(true);
  });
});

describe('Follow-up Tests', () => {
  it('runs none when every HTTP test passes, or only the Internal Service fails', async () => {
    const normal = await observeFaults([], 1);
    expect(rowsOf(normal.reports[0]).every((r) => r.endsWith('http'))).toBe(true);
    const localDown = await observeFaults(['localDown'], 1);
    expect(localDown.reports[0]?.tests_this_round).toBe(6);
  });

  it('runs DNS and TCP only for the failed External Site, on every reporting Probe', async () => {
    const { reports } = await observeFaults(['siteXDown'], 1);
    expect(rowsOf(reports[0]).filter((r) => !r.endsWith('http'))).toEqual([
      'A site-x dns',
      'A site-x tcp',
      'B site-x dns',
      'B site-x tcp',
    ]);
    expect(reports[0]?.tests_this_round).toBe(10);
    expect(reports[0]?.tests_if_full_sweep).toBe(14);
  });

  it('runs a Full Sweep worth of tests when every External Site fails', async () => {
    const { reports } = await observeFaults(['egress'], 1);
    expect(reports[0]?.tests_this_round).toBe(14);
    expect(reports[0]?.tests_if_full_sweep).toBe(14);
  });

  it('does not ask a Probe again in a Round once it failed to answer the HTTP call', async () => {
    const sim = createSimulatedProbes(new Set(['siteXDown']));
    let aCalls = 0;
    // A misses its first call, then would answer: any A Result would show it was asked again.
    const flaky: ProbeClient = {
      run: (probeId, roundId, tests) => (probeId === 'A' && aCalls++ === 0 ? Promise.resolve(null) : sim.run(probeId, roundId, tests)),
    };
    const lab = createSimLab({ client: flaky });
    const report = await lab.round();
    expect(rowsOf(report)).toEqual(['B local-service http', 'B site-x dns', 'B site-x http', 'B site-x tcp', 'B site-y http']);
    expect(report.tests_this_round).toBe(5);
    expect(report.tests_if_full_sweep).toBe(7);
  });
});

describe('Round ordering', () => {
  it('stays numeric past Round 10', async () => {
    const lab = createSimLab();
    await lab.rounds(9);
    lab.faults.add('dnsA');
    const [tenth, eleventh] = await lab.rounds(2);
    expect(tenth?.round_id).toBe(10);
    expect(eleventh?.round_id).toBe(11);
    expect(eleventh?.keys).toEqual(['dns|A']);
    expect(eleventh?.findings[0]?.rounds_seen).toBe(2);
    expect(eleventh?.alert).toBe(true);
  });
});

describe('Collector-stamped times', () => {
  it('ignores the times a Probe with a skewed clock sends, so its Results are not Stale', async () => {
    const lab = createSimLab();
    lab.faults.add('clockA');
    const [, report] = await lab.rounds(2);
    const now = lab.clock.now();
    expect(report?.stale).toBe(false);
    expect(report?.keys).toEqual(['probe|A']);
    expect(report?.probes.map((p) => [p.state, p.last_seen_ms])).toEqual([
      ['reported', now],
      ['reported', now],
    ]);
    for (const r of report?.results ?? []) {
      expect(r.started_at).toBe(now);
      expect(r.finished_at).toBe(now);
    }
  });

  it('stamps started_at before the Probe call and finished_at when its answer arrives', async () => {
    const sim = createSimulatedProbes();
    const answer: Partial<Record<ProbeId, () => void>> = {};
    const client: ProbeClient = {
      run: (probeId, roundId, tests) =>
        new Promise((resolve) => {
          answer[probeId] = () => resolve(sim.run(probeId, roundId, tests));
        }),
    };
    const lab = createSimLab({ client });
    const start = lab.clock.now();
    const round = lab.collector.runRound();
    const settle = () => new Promise((r) => setImmediate(r));
    await settle();
    lab.clock.advance(120);
    answer.A?.();
    await settle();
    lab.clock.advance(80);
    answer.B?.();
    const report = await round;
    const times = new Set(report?.results.map((r) => `${r.probe_id} ${r.started_at - start} ${r.finished_at - start}`));
    // both calls start together; each finishes when its own answer arrives
    expect([...times].sort()).toEqual(['A 0 120', 'B 0 200']);
    expect((report?.finished_at ?? 0) - start).toBe(200);
  });
});

describe('Result store', () => {
  const readJsonl = (path: string): unknown[] =>
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l));

  it('appends every Result to the JSONL file', async () => {
    const lab = createSimLab();
    lab.faults.add('siteXDown');
    const reports = await lab.rounds(3);
    const all: Result[] = reports.flatMap((r) => r.results);
    expect(all).toHaveLength(30);
    expect(readJsonl(lab.jsonlPath)).toEqual(all);
  });

  it('forgets stored Results on reset, writes a marker, and the next Diagnosis starts fresh', async () => {
    const lab = createSimLab();
    lab.faults.add('dnsA');
    const before = await lab.rounds(2);
    expect(before[1]?.alert).toBe(true);

    lab.collector.reset();
    const resetAt = lab.clock.now();
    expect(lab.collector.report()).toBeNull();

    const after = await lab.round();
    expect(after.keys).toEqual(['dns|A']);
    expect(after.findings[0]?.evidence_level).toBe('initial');
    expect(after.findings[0]?.rounds_seen).toBe(1);
    expect(after.alert).toBe(false);
    expect(after.round_id).toBeGreaterThan(before[1]?.round_id ?? Infinity);

    expect(readJsonl(lab.jsonlPath)).toEqual([...before.flatMap((r) => r.results), { reset: true, at: resetAt }, ...after.results]);
  });
});

describe('server answered with a bad HTTP status', () => {
  it('is labelled ตอบสถานะผิดปกติ and not blamed on a certificate', async () => {
    const sim = createSimulatedProbes();
    const client: ProbeClient = {
      run: async (probeId, roundId, tests) => {
        const answer = await sim.run(probeId, roundId, tests);
        if (!answer) return null;
        return {
          ...answer,
          results: answer.results.map((r) =>
            r.target === 'site-x' && r.test === 'http' ? { ...r, success: false, error_type: 'http_status' as const } : r,
          ),
        };
      },
    };
    const lab = createSimLab({ client });
    const report = await lab.round();
    expect(report.keys).toEqual(['dest|site-x']);
    const finding = report.findings[0];
    expect(finding?.title).toBe('เว็บไซต์ X ตอบกลับ แต่คำตอบผิดปกติ');
    expect(finding?.supporting[0]).toBe('ทุกจุดเข้า เว็บไซต์ X ไม่ได้ ในรอบนี้ (ครั้งแรก) (ตอบสถานะผิดปกติ)');
    expect(finding?.supporting.join(' ')).not.toContain('ใบรับรอง');
  });
});
