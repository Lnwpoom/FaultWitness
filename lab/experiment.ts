// `lab experiment`: runs every Scenario in the real Lab at the real cadence, scores each Round and
// writes results/experiment-<timestamp>.md (the slide tables) and .jsonl (every Result).
//
//   npm run lab -- experiment              main and extended tables
//   npm run lab -- experiment --main       main table only
//   npm run lab -- experiment --scenario dnsA   one Scenario (normal or a Fault name)
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NoDataReport, Report } from '../src/shared/types.ts';
import { COLLECTOR_URL, getReport, isReport, resetCollector, setPaused } from './collector-api.ts';
import { LAB_DIR, docker, sleep } from './docker.ts';
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

/** What the experiment needs from the Lab and the Collector; tests pass fakes. */
export interface ExperimentEnv {
  outDir: string;
  cadenceMs: number;
  /** whether the Docker daemon answers */
  dockerUp: () => boolean;
  getReport: () => Promise<Report | NoDataReport>;
  resetCollector: () => Promise<unknown>;
  setPaused: (paused: boolean) => Promise<unknown>;
  clearAll: () => Promise<void>;
  applyFault: (name: FaultName) => Promise<void>;
  netemAvailable: () => boolean;
}

function labEnv(): ExperimentEnv {
  return {
    outDir: join(LAB_DIR, '..', 'results'),
    cadenceMs: loadConfig(join(LAB_DIR, 'config.json')).cadence_ms,
    dockerUp: () => docker(['info'], 15_000).ok,
    getReport,
    resetCollector,
    setPaused,
    clearAll,
    applyFault,
    netemAvailable,
  };
}

/** Why the experiment cannot start (Docker or the Lab is down), or null. */
async function notReady(env: ExperimentEnv): Promise<string | null> {
  if (await env.getReport().then(() => true, () => false)) return null;
  if (!env.dockerUp()) return 'ติดต่อ Docker ไม่ได้ — เปิด Docker Desktop ให้ขึ้นว่า running แล้วรัน npm run lab -- up';
  return `ติดต่อ Collector ที่ ${COLLECTOR_URL} ไม่ได้ — รัน npm run lab -- up (และ npm run lab -- selfcheck) ก่อน`;
}

/** Why a Scenario cannot run on this host, or null. */
function unavailable(id: string, env: ExperimentEnv): string | null {
  if (id === 'slowA' && !env.netemAvailable()) return 'netem ไม่มีในเคอร์เนลของเครื่องนี้ (ต้องรันบนเครื่องที่มี sch_netem)';
  return null;
}

/** Whether the run has been interrupted (Ctrl-C); checked while waiting for Rounds. */
interface RunState {
  stopping: boolean;
}

/** Waits for the next Round after `afterRound` and returns its report. */
async function nextRound(afterRound: number, timeoutMs: number, run: RunState, env: ExperimentEnv): Promise<Report> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (run.stopping) throw new Error('interrupted');
    const r = await env.getReport().catch(() => null);
    if (r && isReport(r) && r.round_id > afterRound) return r;
    await sleep(200);
  }
  throw new Error(`no new Round within ${timeoutMs / 1000} s; is the Lab up (npm run lab -- up)?`);
}

async function runScenario(plan: ScenarioPlan, jsonl: string, run: RunState, env: ExperimentEnv): Promise<ScenarioRun> {
  const reason = unavailable(plan.id, env);
  if (reason) return { plan, notRun: reason, appliedAt: null, rounds: [] };

  await env.clearAll();
  // reset after the current Round has finished writing, so no streak leaks in from before
  const before = await env.getReport().catch(() => null);
  await env.resetCollector();
  let last = isReport(before) ? before.round_id : 0;
  const wait = env.cadenceMs * 3;
  const record = (r: Report, phase: string) => {
    appendFileSync(jsonl, r.results.map((x) => JSON.stringify({ scenario: plan.id, phase, ...x }) + '\n').join(''));
  };

  let appliedAt: number | null = null;
  let clearedAt: number | null = null;
  if (isFaultName(plan.id)) {
    for (let i = 0; i < WARMUP_ROUNDS; i++) {
      const r = await nextRound(last, wait, run, env);
      last = r.round_id;
      record(r, 'warmup');
    }
    // straight after a Round, so the next Round is the first to run entirely under the Fault
    appliedAt = Date.now();
    await env.applyFault(plan.id);
    // blipA returns only once it has cleared itself after the Round that saw it
    if (plan.id === 'blipA') clearedAt = Date.now();
  }

  const rounds: ObservedRound[] = [];
  while (rounds.length < OBSERVED_ROUNDS) {
    const r = await nextRound(last, wait, run, env);
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
  await env.clearAll();
  return { plan, appliedAt, rounds };
}

function parseArgs(args: string[]): { main: boolean; extended: boolean; only: 'normal' | FaultName | null } | string {
  if (args.includes('--main')) return { main: true, extended: false, only: null };
  if (args.includes('--extended')) return { main: false, extended: true, only: null };
  const i = args.indexOf('--scenario');
  if (i >= 0) {
    const id = args[i + 1] ?? '';
    if (id === 'normal' || isFaultName(id)) return { main: false, extended: false, only: id };
    return `unknown Scenario ${JSON.stringify(id)}`;
  }
  if (args.length) return `unknown option ${args[0]}`;
  return { main: true, extended: true, only: null };
}

export async function experiment(args: string[], env: ExperimentEnv = labEnv()): Promise<number> {
  const opts = parseArgs(args);
  if (typeof opts === 'string') {
    console.error(`experiment: ${opts}; use --main, --extended or --scenario <normal|Fault>`);
    return 2;
  }
  const notReadyReason = await notReady(env);
  if (notReadyReason) {
    console.error(`experiment: ${notReadyReason}\nไม่ได้เขียนไฟล์ผล`);
    return 1;
  }
  const { cadenceMs, outDir } = env;
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  mkdirSync(outDir, { recursive: true });
  const md = join(outDir, `experiment-${stamp}.md`);
  // created by the first recorded Round, so a run that measures nothing leaves no file
  const jsonl = join(outDir, `experiment-${stamp}.jsonl`);

  const state: RunState = { stopping: false };
  const onSignal = () => {
    if (state.stopping) return;
    state.stopping = true;
    console.error('\nหยุดการทดลอง — กำลังคืนค่าห้องแล็บ…');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const main: ScenarioRun[] = [];
  const extended: ScenarioRun[] = [];
  let code = 0;
  try {
    await env.setPaused(false);
    const runOne = async (plan: ScenarioPlan, into: ScenarioRun[]) => {
      console.log(`สถานการณ์: ${plan.name} (${plan.id})`);
      const result = await runScenario(plan, jsonl, state, env);
      if (result.notRun) console.log(`  ไม่ได้รัน: ${result.notRun}`);
      into.push(result);
    };
    if (opts.only) {
      const inMain = MAIN.find((s) => s.id === opts.only);
      await runOne(planOf(opts.only, inMain?.name), inMain ? main : extended);
    }
    if (opts.main) for (const s of MAIN) await runOne(planOf(s.id, s.name), main);
    if (opts.extended) for (const id of EXTENDED) await runOne(planOf(id), extended);
  } catch (e) {
    console.error(`experiment: ${(e as Error).message}`);
    code = state.stopping ? 130 : 1;
  } finally {
    // always leave the Lab normal and the scheduler running
    await env.clearAll().catch((e: unknown) => console.error(`clear failed: ${(e as Error).message}`));
    await env.setPaused(false).catch(() => undefined);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  if (![...main, ...extended].some((r) => r.rounds.length > 0)) {
    console.error('\nไม่มีรอบที่วัดได้ — ไม่ได้เขียนไฟล์ผล');
    return code || 1;
  }
  writeFileSync(md, renderMarkdown({ startedAt, finishedAt: new Date(), cadenceMs, main, extended }));
  console.log(`\nเขียนผลแล้ว: ${md}\n            ${jsonl}`);
  return code;
}
