// The Diagnosis: from stored Results only (never Fault or Scenario names) to an explained
// verdict. Ported from the prototype's `<script id="logic">` by adding types; Thai text is
// verbatim except where a comment marks a deliberate change.

import {
  EXTERNAL_SITES,
  PROBE_IDS,
  TARGET_IDS,
  type EvidenceLevel,
  type ExternalSiteId,
  type FindingCode,
  type ProbeId,
  type ProbeState,
  type Result,
  type TargetId,
  type TestKind,
} from '../shared/types.ts';
import { ERR, LEVEL, PROBE_STATE, STATUS, TN } from './labels.ts';
import { FULL_SWEEP_PER_PROBE } from './plan.ts';

/** A Round older than this (ms) is Stale; a Probe silent for longer has lost contact. */
export const DEFAULT_STALE_AFTER_MS = 25_000;
/** Diagnosis looks back over at most this many of the most recent Rounds. */
export const MAX_ROUNDS = 20;

export interface DiagnoseOptions {
  staleAfterMs?: number;
}

export interface Finding {
  /** scoring key, e.g. `dns|A`, `dest|site-x`, `shared`, `insufficient` */
  key: string;
  code: Exclude<FindingCode, 'normal'>;
  status: string;
  title: string;
  evidence: string[];
  missing: string[];
  next: string[];
  /** consecutive Rounds, ending with the latest, in which this key was found */
  streak: number;
  level: EvidenceLevel;
  levelLabel: string;
}

export interface Observation {
  probe: ProbeId;
  peer: ProbeId;
  ratio: number;
  text: string;
  next: string[];
}

export interface ProbeInfo {
  probe: ProbeId;
  /** epoch ms of the Probe's latest Result, or null if it never reported */
  lastSeen: number | null;
  inLatest: boolean;
  state: ProbeState;
  label: string;
}

export interface Diagnosis {
  roundId: number;
  /** epoch ms when the latest Round finished */
  finishedAt: number;
  ageMs: number;
  stale: boolean;
  overall: string;
  /** sorted, de-duplicated Finding keys; empty means normal */
  keys: string[];
  alert: boolean;
  findings: Finding[];
  observations: Observation[];
  probes: ProbeInfo[];
  /** the latest Round's Results */
  rows: Result[];
  tests: number;
  full: number;
}

// ---- path state per Probe and Target ----
//   ok      HTTP by hostname succeeded
//   dns     HTTP failed, TCP to the fixed IP ok, DNS lookup failed  → path fine, naming broken
//   svc     HTTP failed, TCP ok, DNS ok                             → server answered wrongly (TLS/HTTP)
//   down    TCP to the fixed IP failed (or internal HTTP failed)
//   unknown HTTP failed but no follow-up ran;  none = probe sent nothing
type PathState = 'ok' | 'dns' | 'svc' | 'down' | 'unknown' | 'none';
type Cell = Partial<Record<TestKind, Result>> & { dnsFail: boolean; state: PathState };
type Cells = Record<ProbeId, Record<TargetId, Cell>>;

const STATE_TH: Record<Exclude<PathState, 'ok'>, string> = {
  down: 'เข้าไม่ได้',
  svc: 'ต่อได้แต่บริการตอบผิด',
  dns: 'แปลงชื่อไม่ได้',
  unknown: 'ยังไม่ได้ตรวจต่อ',
  none: 'ไม่มีผล',
};

const list = (ts: readonly TargetId[]) => ts.map((t) => TN[t]).join(' และ ');
const errOf = (r: Result | undefined) => (r ? (r.error_type ? ERR[r.error_type] : '-') : 'ไม่มีผล');

function first<T>(xs: readonly T[]): T {
  const x = xs[0];
  if (x === undefined) throw new Error('diagnosis: expected a non-empty list');
  return x;
}

function last<T>(xs: readonly T[]): T {
  const x = xs[xs.length - 1];
  if (x === undefined) throw new Error('diagnosis: expected a non-empty list');
  return x;
}

function cells(rows: readonly Result[]): Cells {
  const blank = (): Cell => ({ dnsFail: false, state: 'none' });
  const perTarget = (): Record<TargetId, Cell> => ({ 'local-service': blank(), 'site-x': blank(), 'site-y': blank() });
  const c: Cells = { A: perTarget(), B: perTarget() };
  for (const r of rows) c[r.probe_id][r.target][r.test] = r;
  for (const p of PROBE_IDS) {
    for (const t of TARGET_IDS) {
      const x = c[p][t];
      x.dnsFail = !!x.dns && !x.dns.success;
      x.state = !x.http
        ? 'none'
        : x.http.success
          ? 'ok'
          : t === 'local-service'
            ? 'down'
            : !x.tcp
              ? 'unknown'
              : !x.tcp.success
                ? 'down'
                : x.dnsFail
                  ? 'dns'
                  : 'svc';
    }
  }
  return c;
}

type RuleFinding =
  | { code: 'dns'; probe: ProbeId; targets: ExternalSiteId[]; viaIp: ExternalSiteId[]; peers: ProbeId[] }
  | { code: 'shared'; probes: ProbeId[] }
  | { code: 'dest'; target: TargetId; witness: ExternalSiteId; svc: boolean }
  | { code: 'probe'; probe: ProbeId; peer: ProbeId; targets: TargetId[] }
  | { code: 'insufficient'; leftovers: { probe: ProbeId; target: TargetId; state: Exclude<PathState, 'ok'> }[] }
  | { code: 'nodata'; absent: ProbeId[]; present: ProbeId[] };

function keyOf(f: RuleFinding): string {
  switch (f.code) {
    case 'nodata':
      return 'insufficient';
    case 'dns':
    case 'probe':
      return `${f.code}|${f.probe}`;
    case 'dest':
      return `dest|${f.target}`;
    default:
      return f.code;
  }
}

interface RoundVerdict {
  probes: ProbeId[];
  cells: Cells;
  findings: RuleFinding[];
  tests: number;
  full: number;
}

// One Round in isolation → findings. Each rule "covers" the (probe, target) failures it explains;
// anything left uncovered becomes "ข้อมูลยังไม่พอ" instead of a guess.
function diagnoseRound(rows: readonly Result[]): RoundVerdict {
  const probes = PROBE_IDS.filter((p) => rows.some((r) => r.probe_id === p));
  const c = cells(rows);
  const st = (p: ProbeId, t: TargetId) => c[p][t].state;
  const reach = (p: ProbeId, t: TargetId) => st(p, t) === 'ok' || st(p, t) === 'dns';
  const bad = (p: ProbeId, t: TargetId) => st(p, t) === 'down' || st(p, t) === 'svc';
  const covered = new Set<string>();
  const cover = (p: ProbeId, t: TargetId) => covered.add(p + '|' + t);
  const F: RuleFinding[] = [];

  // R1 DNS (works from a single probe): lookup failed AND (TCP to IP ok  OR  another probe resolved the same name)
  for (const p of probes) {
    const peers = probes.filter((q) => q !== p);
    const ts = EXTERNAL_SITES.filter(
      (t) => c[p][t].dnsFail && (st(p, t) === 'dns' || peers.some((q) => c[q][t].dns?.success === true)),
    );
    if (!ts.length) continue;
    ts.filter((t) => st(p, t) === 'dns').forEach((t) => cover(p, t));
    F.push({
      code: 'dns',
      probe: p,
      targets: ts,
      viaIp: ts.filter((t) => st(p, t) === 'dns'),
      peers: peers.filter((q) => ts.every((t) => c[q][t].dns?.success === true)),
    });
  }
  if (probes.length >= 2) {
    // R2 shared external: every probe reaches internal, no probe reaches any external by IP
    if (
      EXTERNAL_SITES.every((t) => probes.every((p) => st(p, t) === 'down')) &&
      probes.every((p) => st(p, 'local-service') === 'ok')
    ) {
      F.push({ code: 'shared', probes });
      probes.forEach((p) => EXTERNAL_SITES.forEach((t) => cover(p, t)));
    } else {
      // R3 one destination: every probe fails it, and every probe reaches some OTHER external target
      for (const t of TARGET_IDS) {
        if (!probes.every((p) => bad(p, t))) continue;
        const witness = EXTERNAL_SITES.find((o) => o !== t && probes.every((p) => reach(p, o)));
        if (!witness) continue;
        F.push({ code: 'dest', target: t, witness, svc: probes.every((p) => st(p, t) === 'svc') });
        probes.forEach((p) => cover(p, t));
      }
    }
    // R4 one probe: it fails a target the other probe reaches in the same round
    for (const p of probes) {
      const q = probes.find((x) => x !== p);
      if (!q) continue;
      const ts = TARGET_IDS.filter((t) => !covered.has(p + '|' + t) && bad(p, t) && reach(q, t));
      if (!ts.length) continue;
      ts.forEach((t) => cover(p, t));
      F.push({ code: 'probe', probe: p, peer: q, targets: ts });
    }
  }
  const leftovers: { probe: ProbeId; target: TargetId; state: Exclude<PathState, 'ok'> }[] = [];
  for (const p of probes) {
    for (const t of TARGET_IDS) {
      const state = st(p, t);
      if (state !== 'ok' && !covered.has(p + '|' + t)) leftovers.push({ probe: p, target: t, state });
    }
  }
  if (leftovers.length) F.push({ code: 'insufficient', leftovers });
  const absent = PROBE_IDS.filter((p) => !probes.includes(p));
  if (absent.length) F.push({ code: 'nodata', absent, present: probes });
  return { probes, cells: c, findings: F, tests: rows.length, full: probes.length * FULL_SWEEP_PER_PROBE };
}

interface ExplainContext {
  cells: Cells;
  probes: ProbeId[];
  probeInfo: Record<ProbeId, ProbeInfo>;
  now: number;
}

interface Explanation {
  title: string;
  evidence: string[];
  missing: string[];
  next: string[];
}

function explain(f: RuleFinding, ctx: ExplainContext, streak: number): Explanation {
  const c = ctx.cells;
  const seen = streak >= 2 ? `${streak} รอบติดกัน` : 'ในรอบนี้ (ครั้งแรก)';
  const firstTime = streak < 2 ? ['ยังไม่พบซ้ำ — อาจเป็นการสะดุดชั่วคราว รอรอบถัดไปก่อนแจ้งเตือน'] : [];
  switch (f.code) {
    case 'dns': {
      const p = f.probe;
      const q = f.peers[0] ?? 'อีกจุด';
      const evidence = [`${p} แปลงชื่อ ${list(f.targets)} ไม่สำเร็จ ${seen} (${errOf(c[p][first(f.targets)].dns)})`];
      if (f.viaIp.length) evidence.push(`แต่ ${p} ต่อ TCP ไปยัง IP ของ ${list(f.viaIp)} สำเร็จ → เส้นทางไปปลายทางยังใช้ได้`);
      for (const x of f.peers) {
        evidence.push(`${x} แปลงชื่อเดียวกันได้${f.targets.every((t) => c[x][t].state === 'ok') ? ' และเข้าเว็บไซต์เดียวกันได้' : ''}`);
      }
      const missing = [`ยังไม่รู้ว่า resolver ที่ตั้งไว้บน ${p} คือเครื่องใด (FaultWitness ไม่อ่านค่าตั้งของเครื่อง)`];
      if (!f.viaIp.length) missing.push(`TCP จาก ${p} ก็ไม่ผ่าน จึงยังแยกไม่ได้ว่า DNS เสียเอง หรือเป็นอาการร่วมของเส้นทาง`);
      if (!f.peers.length) missing.push('ไม่มีผลจากอีกจุดมาเทียบ');
      return {
        title: `พบความผิดปกติของ DNS ที่ Probe ${p} ใช้`,
        evidence,
        missing: [...missing, ...firstTime],
        next: [`เปรียบเทียบ DNS resolver ที่ตั้งไว้บน ${p} กับ ${q}`, `ลองถามชื่อเดียวกันจาก ${p} ผ่าน resolver ของ ${q}`],
      };
    }
    case 'probe': {
      const p = f.probe;
      const q = f.peer;
      const evidence: string[] = [];
      for (const t of f.targets) {
        const x = c[p][t];
        const y = c[q][t];
        evidence.push(
          x.state === 'svc'
            ? `${p} ต่อ TCP ไป ${TN[t]} ได้ แต่ HTTPS ไม่ผ่าน (${errOf(x.http)})`
            : `${p} เข้า ${TN[t]} ไม่ได้ ${seen} (${errOf(x.tcp && !x.tcp.success ? x.tcp : x.http)})`,
        );
        evidence.push(
          y.state === 'ok'
            ? `${q} เข้า ${TN[t]} ได้ในรอบเดียวกัน (${y.http?.duration_ms} ms)`
            : `TCP จาก ${q} ไป ${TN[t]} สำเร็จในรอบเดียวกัน`,
        );
      }
      const local = f.targets.includes('local-service');
      const svc = f.targets.some((t) => c[p][t].state === 'svc');
      const next: string[] = [];
      if (local) next.push(`ตรวจ IP, gateway และไฟร์วอลล์บนเครื่อง ${p}`, `ย้าย ${p} ไปเชื่อมต่อจุดเดียวกับ ${q} แล้วตรวจซ้ำ`);
      if (svc) next.push(`ตรวจนาฬิกาของเครื่อง ${p} และโปรแกรมที่ดักใบรับรอง (proxy/แอนตี้ไวรัส)`);
      if (f.targets.some((t) => t !== 'local-service' && c[p][t].state === 'down')) {
        next.push(`ตรวจเส้นทางขาออกของ ${p} (gateway/route ที่ได้รับ)`);
      }
      return {
        title:
          local && f.targets.length === 1
            ? `${p} เข้าบริการภายในไม่ได้ แต่ ${q} เข้าได้`
            : svc
              ? `${p} ผ่าน HTTPS ไม่ได้ ขณะที่ ${q} ผ่านได้`
              : `ปัญหาเฉพาะที่ Probe ${p} หรือเส้นทางจาก ${p}`,
        evidence,
        missing: [`ยังแยกไม่ได้ว่าเป็นตัวเครื่อง ${p} สาย/สัญญาณ หรือเส้นทางในเครือข่าย — จึงยังไม่สรุปว่า Wi-Fi เสีย`, ...firstTime],
        next,
      };
    }
    case 'shared': {
      const p0 = first(f.probes);
      const evidence = [`ทุกจุด (${f.probes.join(', ')}) เข้าบริการภายในได้ → เครือข่ายภายในปกติ`];
      for (const t of EXTERNAL_SITES) evidence.push(`ทุกจุดต่อ TCP ไป ${TN[t]} ไม่ได้ ${seen} (${errOf(c[p0][t].tcp)})`);
      if (EXTERNAL_SITES.every((t) => f.probes.every((p) => c[p][t].dns?.success === true))) {
        evidence.push('ทุกจุดแปลงชื่อได้ → ไม่ใช่ปัญหา DNS');
      }
      return {
        title: 'ทุกจุดออกภายนอกไม่ได้ แต่ภายในปกติ',
        evidence,
        missing: [
          `ทดสอบปลายทางภายนอกเพียง ${EXTERNAL_SITES.length} แห่ง`,
          'ยังไม่รู้ว่าหยุดที่ gateway ของเราหรือหลังจากนั้น — จึงยังไม่สรุปว่า ISP เป็นผู้ทำให้เสีย',
          ...firstTime,
        ],
        next: ['ตรวจ gateway และไฟร์วอลล์ขาออกของเครือข่าย', 'ทดสอบปลายทางภายนอกแห่งที่ 3', 'ติดต่อ ISP พร้อมรายงานนี้ หลังตัดปัญหาฝั่งเราออกแล้ว'],
      };
    }
    case 'dest': {
      const t = f.target;
      const x = c[first(ctx.probes)][t];
      // The prototype's only "server answered wrongly" cause was a certificate. The build adds
      // `http_status`, so the certificate wording is kept for TLS failures and a neutral one is used otherwise.
      const cert = f.svc && ctx.probes.every((p) => c[p][t].http?.error_type === 'tls_cert');
      const evidence = [`ทุกจุดเข้า ${TN[t]} ไม่ได้ ${seen} (${errOf(x.http)})`, `แต่ทุกจุดเข้า ${TN[f.witness]} ได้`];
      if (cert) evidence.push(`TCP ไป ${TN[t]} สำเร็จและแปลงชื่อได้ — เซิร์ฟเวอร์ตอบ แต่ใบรับรอง HTTPS ไม่ผ่าน: เน็ตไม่ได้เสีย`);
      else if (f.svc) evidence.push(`TCP ไป ${TN[t]} สำเร็จและแปลงชื่อได้ — เซิร์ฟเวอร์ตอบ แต่คำตอบไม่ผ่าน (${errOf(x.http)}): เน็ตไม่ได้เสีย`);
      else if (t !== 'local-service') evidence.push(`TCP ไป IP ของ ${TN[t]} ก็ไม่ผ่าน (${errOf(x.tcp)})`);
      return {
        title: cert
          ? `${TN[t]} ตอบกลับ แต่ใบรับรองไม่ผ่าน`
          : f.svc
            ? `${TN[t]} ตอบกลับ แต่คำตอบผิดปกติ`
            : `${TN[t]} ผิดปกติ ขณะที่ปลายทางอื่นปกติ`,
        evidence,
        missing: [...(f.svc ? [] : ['ยังไม่ได้ทดสอบจากนอกเครือข่ายนี้ จึงแยก "ปลายทางล่ม" กับ "เส้นทางเฉพาะไปปลายทาง" ไม่ได้']), ...firstTime],
        next: cert
          ? [`แจ้งผู้ดูแล ${TN[t]} ว่าใบรับรองไม่ผ่าน`]
          : f.svc
            ? [`แจ้งผู้ดูแล ${TN[t]} ว่าเซิร์ฟเวอร์ตอบผิดปกติ`]
            : [`ตรวจว่าบริการ ${TN[t]} ยังทำงาน`, `ทดสอบ ${TN[t]} จากเครือข่ายอื่น เช่น มือถือ`],
      };
    }
    case 'insufficient':
      return {
        title: 'หลักฐานไม่ตรงกับกฎข้อใด',
        evidence: f.leftovers.map((l) => `${l.probe} → ${TN[l.target]}: ${STATE_TH[l.state]}`),
        missing: ['ไม่เดาสาเหตุเมื่อหลักฐานไม่ครบหรือขัดกัน'],
        next: ['ตรวจซ้ำอีกรอบ', 'เพิ่มจุดตรวจหรือปลายทางทดสอบ'],
      };
    case 'nodata': {
      const evidence = f.absent.map((p) => {
        const info = ctx.probeInfo[p];
        return info.lastSeen === null
          ? `${p}: ยังไม่เคยส่งผล`
          : `${p}: ${info.label} (ผลล่าสุด ${Math.round((ctx.now - info.lastSeen) / 1000)} วินาทีก่อน) — ไม่นำผลเก่ามาใช้เป็นสถานะปัจจุบัน`;
      });
      if (f.present.length) evidence.push(`${f.present.join(', ')} ส่งผลรอบนี้ครบ`);
      return {
        title: `ไม่มีผลรอบล่าสุดจาก Probe ${f.absent.join(', ')}`,
        evidence,
        missing: ['ไม่มีผลจากอีกจุดมาเทียบ จึงแยก "ปัญหาร่วม" กับ "ปัญหาเฉพาะจุด" ไม่ได้'],
        // ADR 0002: the Collector pulls, so the check is that the Collector can reach the Probe's port.
        next: f.absent.flatMap((p) => [`ตรวจว่าเครื่อง ${p} เปิดอยู่และ probe ยังทำงาน`, `ตรวจว่าเครื่องหลักเข้าถึงพอร์ตของ Probe ${p} ได้`]),
      };
    }
  }
}

// "one machine is slow" is an observation, never a fault verdict on its own
function slowness(c: Cells, probes: readonly ProbeId[]): Observation[] {
  const out: Observation[] = [];
  for (const p of probes) {
    for (const q of probes) {
      if (p === q) continue;
      const rs = TARGET_IDS.flatMap((t) => {
        const a = c[p][t].http;
        const b = c[q][t].http;
        return a?.success && b?.success && b.duration_ms > 0 ? [a.duration_ms / b.duration_ms] : [];
      }).sort((x, y) => x - y);
      const med = rs[Math.floor(rs.length / 2)];
      if (rs.length < 2 || med === undefined || med < 3) continue;
      out.push({
        probe: p,
        peer: q,
        ratio: Math.round(med),
        text: `${p} ตอบช้ากว่า ${q} ราว ${Math.round(med)} เท่า${c[p]['local-service'].http?.success ? ' รวมถึงบริการภายใน' : ''} แต่ทุกการทดสอบยังผ่าน — สาเหตุอาจอยู่ที่ตัวเครื่อง สาย/สัญญาณ หรือซอฟต์แวร์บน ${p}: ยังไม่สรุปว่า Wi-Fi เสีย`,
        next: [`ดู CPU/โปรแกรมเบื้องหลังบน ${p}`, `สลับ ${p} ไปใช้สาย LAN หรือย้ายตำแหน่ง แล้วเทียบเวลาอีกครั้ง`],
      });
    }
  }
  return out;
}

/**
 * The full Diagnosis from every stored Result, judged at time `now` (epoch ms). Rounds are
 * matched by round id and ordered numerically; Evidence Levels come from consecutive Rounds
 * among the most recent MAX_ROUNDS. Returns null when there are no Results.
 */
export function diagnose(results: readonly Result[], now: number, opts: DiagnoseOptions = {}): Diagnosis | null {
  const staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const byRound = new Map<number, Result[]>();
  const lastSeen: Record<ProbeId, number | null> = { A: null, B: null };
  for (const r of results) {
    const rows = byRound.get(r.round_id);
    if (rows) rows.push(r);
    else byRound.set(r.round_id, [r]);
    const seen = lastSeen[r.probe_id];
    if (seen === null || r.finished_at > seen) lastSeen[r.probe_id] = r.finished_at;
  }
  const ids = [...byRound.keys()].sort((a, b) => a - b).slice(-MAX_ROUNDS);
  if (!ids.length) return null;

  const rounds = ids.map((id) => {
    const rows = byRound.get(id) ?? [];
    return { id, rows, ...diagnoseRound(rows) };
  });
  const latest = last(rounds);
  const finishedAt = latest.rows.reduce((m, r) => Math.max(m, r.finished_at), -Infinity);
  const stale = now - finishedAt > staleAfterMs;

  const infoOf = (p: ProbeId): ProbeInfo => {
    const seen = lastSeen[p];
    const inLatest = latest.probes.includes(p);
    const lost = seen === null || now - seen > staleAfterMs;
    const state: ProbeState = lost ? 'lost' : inLatest ? 'reported' : 'silent';
    return { probe: p, lastSeen: seen, inLatest, state, label: PROBE_STATE[state] };
  };
  const probeInfo: Record<ProbeId, ProbeInfo> = { A: infoOf('A'), B: infoOf('B') };

  const ctx: ExplainContext = { cells: latest.cells, probes: latest.probes, probeInfo, now };
  const findings: Finding[] = latest.findings.map((f) => {
    const key = keyOf(f);
    let streak = 0;
    for (let i = rounds.length - 1; i >= 0 && rounds[i]?.findings.some((g) => keyOf(g) === key); i--) streak++;
    const multi = f.code === 'dns' ? f.peers.length > 0 : f.code === 'probe' || f.code === 'shared' || f.code === 'dest';
    const level: EvidenceLevel = streak >= 2 && multi ? 'confirmed' : streak >= 2 ? 'repeated' : 'initial';
    return {
      key,
      code: f.code,
      status: STATUS[f.code === 'nodata' ? 'insufficient' : f.code],
      streak,
      level,
      levelLabel: LEVEL[level],
      ...explain(f, ctx, streak),
    };
  });
  const keys = [...new Set(findings.map((f) => f.key))].sort();
  const overall = stale
    ? STATUS.insufficient
    : findings.length
      ? [...new Set(findings.map((f) => f.status))].join(' + ')
      : STATUS.normal;
  return {
    roundId: latest.id,
    finishedAt,
    ageMs: now - finishedAt,
    stale,
    overall,
    keys,
    alert: !stale && findings.some((f) => f.streak >= 2),
    findings,
    observations: slowness(latest.cells, latest.probes),
    probes: PROBE_IDS.map((p) => probeInfo[p]),
    rows: latest.rows,
    tests: latest.tests,
    full: latest.full,
  };
}
