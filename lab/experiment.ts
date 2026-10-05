// `lab experiment`: runs every Scenario in the real Lab at the real cadence, scores each Round and
// writes results/experiment-<timestamp>.md (the slide tables) and .jsonl (every Result).
//
//   npm run lab -- experiment              main and extended tables
//   npm run lab -- experiment --main       main table only
//   npm run lab -- experiment --scenario dnsA   one Scenario (normal or a Fault name)
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Report } from '../src/shared/types.ts';
import { getReport, isReport, resetCollector, setPaused } from './collector-api.ts';
import { LAB_DIR, sleep } from './docker.ts';
import { FAULTS, applyFault, clearAll, isFaultName, netemAvailable, type FaultName } from './faults.ts';
import { renderMarkdown, summarize, type ObservedRound, type ScenarioPlan, type ScenarioRun } from './scoring.ts';
import { loadConfig } from '../src/shared/config.ts';

const WARMUP_ROUNDS = 2;
const OBSERVED_ROUNDS = 5;

const MAIN: { id: 'normal' | FaultName; name: string }[] = [
  { id: 'normal', name: 'ปกติ' },
  { id: 'dnsA', name: 'DNS ของ A เสีย' },
  { id: 'siteXDown', name: 'ปลายทางหนึ่งเสีย' },
  { id: 'routeA', name: 'เส้นทางของ A มีปัญหา' },
  { id: 'egress', name: 'เส้นทางออกภายนอกร่วมเสีย' },
];
const EXTENDED: FaultName[] = ['dnsB', 'localDown', 'certX', 'clockA', 'slowA', 'blipA', 'cutA'];

function planOf(id: 'normal' | FaultName, name?: string): ScenarioPlan {
  if (id === 'normal') return { id, name: name ?? 'ปกติ', expected: [], expectAlert: false };
  const f = FAULTS[id];
  return {
    id,
    name: name ?? f.label,
    expected: f.expected,
    ...(f.expectObservation ? { expectObservation: f.expectObservation } : {}),
    expectAlert: f.expected.length > 0 && id !== 'blipA',
  };
}

/** Why a Scenario cannot run on this host, or null. */
function unavailable(id: string): string | null {
  if (id === 'slowA' && !netemAvailable()) return 'netem ไม่มีในเคอร์เนลของเครื่องนี้ (ต้องรันบนเครื่องที่มี sch_netem)';
  return null;
}

let stopping = false;

/** Waits for the next Round after `afterRound` and returns its report. */
async function nextRound(afterRound: number, timeoutMs: number): Promise<Report> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (stopping) throw new Error('interrupted');
    const r = await getReport().catch(() => null);
    if (r && isReport(r) && r.round_id > afterRound) return r;
    await sleep(200);
  }
  throw new Error(`no new Round within ${timeoutMs / 1000} s; is the Lab up (npm run lab -- up)?`);
}

async function runScenario(plan: ScenarioPlan, cadenceMs: number, jsonl: string): Promise<ScenarioRun> {
  const reason = unavailable(plan.id);
  if (reason) return { plan, notRun: reason, appliedAt: null, rounds: [] };

  await clearAll();
  // reset after the current Round has finished writing, so no streak leaks in from before
  const before = await getReport().catch(() => null);
  await resetCollector();
  let last = isReport(before) ? before.round_id : 0;
  const wait = cadenceMs * 3;
  const record = (r: Report, phase: string) => {
    appendFileSync(jsonl, r.results.map((x) => JSON.stringify({ scenario: plan.id, phase, ...x }) + '\n').join(''));
  };

  let appliedAt: number | null = null;
  let clearedAt: number | null = null;
  const fault = plan.id === 'normal' ? null : (plan.id as FaultName);
  if (fault) {
    for (let i = 0; i < WARMUP_ROUNDS; i++) {
      const r = await nextRound(last, wait);
      last = r.round_id;
      record(r, 'warmup');
    }
    // straight after a Round, so the next Round is the first to run entirely under the Fault
    appliedAt = Date.now();
    if (fault === 'blipA') {
      // blipA returns once it has cleared itself after one Round
      await applyFault(fault);
      clearedAt = Date.now();
    } else {
      await applyFault(fault);
    }
  }

  const rounds: ObservedRound[] = [];
  while (rounds.length < OBSERVED_ROUNDS) {
    const r = await nextRound(last, wait);
    last = r.round_id;
    record(r, 'observe');
    const started = Math.min(...r.results.map((x) => x.started_at));
    const active = appliedAt !== null && started >= appliedAt && (clearedAt === null || started < clearedAt);
    rounds.push({
      report: r,
      expected: active ? plan.expected : [],
      faultActive: active,
      ...(active && plan.expectObservation ? { expectObservation: plan.expectObservation } : {}),
    });
    const s = summarize({ plan, appliedAt, rounds: [rounds.at(-1)!] });
    console.log(`  รอบ ${r.round_id}: ${r.keys.join(' + ') || 'ปกติ'}${r.alert ? ' 🔔' : ''} → ${s.correct ? 'ถูก' : s.insufficient ? 'ข้อมูลไม่พอ' : 'ผิด'}`);
  }
  await clearAll();
  return { plan, appliedAt, rounds };
}

function parseArgs(args: string[]): { main: boolean; extended: boolean; only: string | null } | string {
  if (args.includes('--main')) return { main: true, extended: false, only: null };
  if (args.includes('--extended')) return { main: false, extended: true, only: null };
  const i = args.indexOf('--scenario');
  if (i >= 0) {
    const id = args[i + 1] ?? '';
    if (id !== 'normal' && !isFaultName(id)) return `unknown Scenario ${JSON.stringify(id)}`;
    return { main: false, extended: false, only: id };
  }
  if (args.length) return `unknown option ${args[0]}`;
  return { main: true, extended: true, only: null };
}

export async function experiment(args: string[]): Promise<number> {
  const opts = parseArgs(args);
  if (typeof opts === 'string') {
    console.error(`experiment: ${opts}; use --main, --extended or --scenario <normal|Fault>`);
    return 2;
  }
  const cadenceMs = loadConfig(join(LAB_DIR, 'config.json')).cadence_ms;
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = join(LAB_DIR, '..', 'results');
  mkdirSync(outDir, { recursive: true });
  const md = join(outDir, `experiment-${stamp}.md`);
  const jsonl = join(outDir, `experiment-${stamp}.jsonl`);
  writeFileSync(jsonl, '');

  const onSignal = () => {
    if (stopping) return;
    stopping = true;
    console.error('\nหยุดการทดลอง — กำลังคืนค่าห้องแล็บ…');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const main: ScenarioRun[] = [];
  const extended: ScenarioRun[] = [];
  let code = 0;
  try {
    await setPaused(false);
    const run = async (plan: ScenarioPlan, into: ScenarioRun[]) => {
      console.log(`สถานการณ์: ${plan.name} (${plan.id})`);
      const result = await runScenario(plan, cadenceMs, jsonl);
      if (result.notRun) console.log(`  ไม่ได้รัน: ${result.notRun}`);
      into.push(result);
    };
    if (opts.only) {
      const inMain = MAIN.find((s) => s.id === opts.only);
      await run(planOf(opts.only as 'normal' | FaultName, inMain?.name), inMain ? main : extended);
    }
    if (opts.main) for (const s of MAIN) await run(planOf(s.id, s.name), main);
    if (opts.extended) for (const id of EXTENDED) await run(planOf(id), extended);
  } catch (e) {
    console.error(`experiment: ${(e as Error).message}`);
    code = stopping ? 130 : 1;
  } finally {
    // always leave the Lab normal and the scheduler running
    await clearAll().catch((e: unknown) => console.error(`clear failed: ${(e as Error).message}`));
    await setPaused(false).catch(() => undefined);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  writeFileSync(md, renderMarkdown({ startedAt, finishedAt: new Date(), cadenceMs, main, extended }));
  console.log(`\nเขียนผลแล้ว: ${md}\n            ${jsonl}`);
  return code;
}
