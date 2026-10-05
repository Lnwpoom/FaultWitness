// The Fault table: every Fault the Lab can create, how to create and undo it, and the Diagnosis
// keys it should produce (the ground truth the experiment scores against; prototype `Lab.EXPECT`).
import { compose, containerOf, docker, exec, sleep } from './docker.ts';
import { getReport, isReport } from './collector-api.ts';

export const FAULT_NAMES = [
  'dnsA',
  'dnsB',
  'routeA',
  'localDown',
  'siteXDown',
  'certX',
  'egress',
  'clockA',
  'slowA',
  'blipA',
  'cutA',
] as const;
export type FaultName = (typeof FAULT_NAMES)[number];

export interface Fault {
  name: FaultName;
  /** one line of Thai for the presenter */
  label: string;
  /** how the Lab creates it, in Thai */
  how: string;
  /** Diagnosis keys expected while it is active; [] = normal */
  expected: string[];
  /** for slowA: the Diagnosis must also carry an Observation naming this Probe */
  expectObservation?: 'A' | 'B';
  /** throws with a clear message if it cannot be applied; leaves nothing half-applied */
  apply: () => Promise<void>;
  /** undoes it; safe when it is not active */
  clear: () => Promise<void>;
  isActive: () => boolean;
}

const INNER = 'faultwitness-lab_inner';
const RESOLVER = '10.77.1.53';
const INTERNAL_SERVICE = { ip: '10.77.1.20', port: '8081' };
const PROBE_A_IP = '10.77.1.11';
const SLOW_DELAY = '100ms';
/** The command slowA runs on Probe A. Needs the kernel's netem qdisc (sch_netem). */
export const NETEM_COMMAND = ['tc', 'qdisc', 'add', 'dev', 'eth0', 'root', 'netem', 'delay', SLOW_DELAY];

function must(r: { ok: boolean; stderr: string; stdout: string }, what: string): void {
  if (!r.ok) throw new Error(`${what}: ${(r.stderr || r.stdout).trim()}`);
}

// ---- iptables rules tagged with a comment, so status and clear can find exactly ours ----

function addRules(service: string, tag: string, rules: string[][]): void {
  for (const rule of rules) {
    const [chain, ...spec] = rule;
    const r = exec(service, ['iptables', '-I', chain!, ...spec, '-m', 'comment', '--comment', `fw-${tag}`]);
    if (!r.ok) {
      removeRules(service, tag);
      must(r, `iptables on ${service}`);
    }
  }
}

function taggedRules(service: string, tag: string): string[] {
  const r = exec(service, ['iptables', '-S']);
  return r.stdout.split('\n').filter((l) => l.includes(`--comment fw-${tag}`) && l.startsWith('-A '));
}

function removeRules(service: string, tag: string): void {
  for (const line of taggedRules(service, tag)) {
    exec(service, ['sh', '-c', `iptables ${line.replace(/^-A /, '-D ')}`]);
  }
}

// Drops the resolver's answers rather than the queries: a dropped outgoing packet fails at once
// with EPERM, while a resolver that does not answer makes the Probe wait out its DNS timeout.
const dropDns = (probe: 'a' | 'b', tag: string) => () => {
  addRules(`probe-${probe}`, tag, [
    ['INPUT', '-s', RESOLVER, '-p', 'udp', '--sport', '53', '-j', 'DROP'],
    ['INPUT', '-s', RESOLVER, '-p', 'tcp', '--sport', '53', '-j', 'DROP'],
  ]);
};

// Only the Internal Service's port: blocking the Probe's own /run port would turn this into cutA.
const blockInternal = (tag: string) => () =>
  addRules('probe-a', tag, [
    ['OUTPUT', '-d', INTERNAL_SERVICE.ip, '-p', 'tcp', '--dport', INTERNAL_SERVICE.port, '-j', 'DROP'],
  ]);

function iptablesFault(service: string, tag: string, apply: () => void) {
  return {
    apply: async () => apply(),
    clear: async () => removeRules(service, tag),
    isActive: () => taggedRules(service, tag).length > 0,
  };
}

function writeClock(value: string): void {
  must(exec('probe-a', ['sh', '-c', `mkdir -p /run/faketime && echo '${value}' > /run/faketime/rc`]), 'faketime');
}

function probeAOnInner(): boolean {
  const id = containerOf('probe-a');
  if (!id) return false;
  const r = docker(['inspect', '-f', '{{json .NetworkSettings.Networks}}', id]);
  return r.stdout.includes(`"${INNER}"`);
}

/** Whether this host's kernel offers netem; slowA and its Scenario need it. */
export function netemAvailable(): boolean {
  const r = exec('probe-a', ['sh', '-c', 'tc qdisc add dev lo root netem delay 1ms && tc qdisc del dev lo root']);
  return r.ok;
}

/** Waits for the Round that sees blipA, then clears it, so exactly one Round carries it. */
async function clearBlipAfterOneRound(startRound: number | null): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const report = await getReport().catch(() => null);
    if (isReport(report) && startRound !== null) {
      if (report.keys.includes('probe|A') || report.round_id >= startRound + 2) break;
    } else if (isReport(report)) {
      if (report.keys.includes('probe|A')) break;
    }
    await sleep(250);
  }
  removeRules('probe-a', 'blipA');
}

export const FAULTS: Record<FaultName, Fault> = {
  dnsA: {
    name: 'dnsA',
    label: 'DNS ที่ A ใช้ไม่ตอบ',
    how: 'iptables บน Probe A ทิ้งคำตอบจาก resolver พอร์ต 53 — A ถาม DNS แล้วไม่มีใครตอบ',
    expected: ['dns|A'],
    ...iptablesFault('probe-a', 'dnsA', dropDns('a', 'dnsA')),
  },
  dnsB: {
    name: 'dnsB',
    label: 'DNS ที่ B ใช้ไม่ตอบ',
    how: 'iptables บน Probe B ทิ้งคำตอบจาก resolver พอร์ต 53 — B ถาม DNS แล้วไม่มีใครตอบ',
    expected: ['dns|B'],
    ...iptablesFault('probe-b', 'dnsB', dropDns('b', 'dnsB')),
  },
  routeA: {
    name: 'routeA',
    label: 'เส้นทาง A → บริการภายในถูกบล็อก',
    how: 'iptables บน Probe A ทิ้งแพ็กเก็ตไปพอร์ตของบริการภายในเท่านั้น (ไม่บล็อกพอร์ตของ Probe เอง)',
    expected: ['probe|A'],
    ...iptablesFault('probe-a', 'routeA', blockInternal('routeA')),
  },
  localDown: {
    name: 'localDown',
    label: 'เซิร์ฟเวอร์ภายในหยุด',
    how: 'หยุดคอนเทนเนอร์บริการภายใน',
    expected: ['dest|local-service'],
    apply: async () => must(compose(['stop', '-t', '1', 'local-service']), 'stop local-service'),
    clear: async () => {
      if (!FAULTS.localDown.isActive()) return;
      must(compose(['start', 'local-service']), 'start local-service');
    },
    isActive: () => compose(['ps', '-q', '--status', 'running', 'local-service']).stdout.trim() === '',
  },
  siteXDown: {
    name: 'siteXDown',
    label: 'เว็บไซต์ X หยุดให้บริการ',
    how: 'iptables บนเว็บไซต์ X ตอบ tcp-reset ที่พอร์ต 443 (พอร์ตปิด)',
    expected: ['dest|site-x'],
    ...iptablesFault('site-x', 'siteXDown', () =>
      addRules('site-x', 'siteXDown', [['INPUT', '-i', 'eth0', '-p', 'tcp', '--dport', '443', '-j', 'REJECT', '--reject-with', 'tcp-reset']]),
    ),
  },
  certX: {
    name: 'certX',
    label: 'ใบรับรองของเว็บไซต์ X หมดอายุ',
    how: 'สลับเว็บไซต์ X ไปใช้ใบรับรองที่หมดอายุ แล้ว reload nginx',
    expected: ['dest|site-x'],
    apply: async () => must(exec('site-x', ['use-cert', 'expired']), 'use-cert expired'),
    clear: async () => {
      if (FAULTS.certX.isActive()) must(exec('site-x', ['use-cert', 'valid']), 'use-cert valid');
    },
    isActive: () => exec('site-x', ['cmp', '-s', '/lab/active/cert.pem', '/lab/certs/site-x-expired.crt']).ok,
  },
  egress: {
    name: 'egress',
    label: 'ทางออกภายนอกร่วมถูกบล็อก',
    how: 'iptables บน gateway ทิ้งการส่งต่อไปเครือข่ายภายนอก (resolver ยังอยู่ภายใน)',
    expected: ['shared'],
    ...iptablesFault('gateway', 'egress', () =>
      addRules('gateway', 'egress', [['FORWARD', '-d', '10.77.2.0/24', '-j', 'DROP']]),
    ),
  },
  clockA: {
    name: 'clockA',
    label: 'นาฬิกาเครื่อง A เพี้ยน',
    how: 'ตั้งนาฬิกาของ Probe A ย้อนไป 2019-01-01 ด้วย libfaketime → ใบรับรองทุกเว็บ "ยังไม่ถึงวันใช้"',
    expected: ['probe|A'],
    apply: async () => writeClock('@2019-01-01 00:00:00'),
    clear: async () => writeClock('+0'),
    isActive: () => {
      const r = exec('probe-a', ['cat', '/run/faketime/rc']);
      return r.ok && r.stdout.trim() !== '+0';
    },
  },
  slowA: {
    name: 'slowA',
    label: 'เครื่อง A ช้า (แต่ยังใช้ได้)',
    how: `tc netem หน่วงทุกแพ็กเก็ตขาออกของ Probe A ${SLOW_DELAY} — ทุกการทดสอบยังผ่าน`,
    expected: [],
    expectObservation: 'A',
    apply: async () => {
      if (!netemAvailable()) {
        throw new Error(`netem not available on this host (needs the sch_netem kernel module); would run: ${NETEM_COMMAND.join(' ')}`);
      }
      must(exec('probe-a', NETEM_COMMAND), 'tc netem');
    },
    clear: async () => {
      if (FAULTS.slowA.isActive()) exec('probe-a', ['tc', 'qdisc', 'del', 'dev', 'eth0', 'root']);
    },
    isActive: () => exec('probe-a', ['tc', 'qdisc', 'show', 'dev', 'eth0']).stdout.includes('netem'),
  },
  blipA: {
    name: 'blipA',
    label: 'A สะดุด 1 รอบ แล้วหายเอง',
    how: 'บล็อก A → บริการภายในหนึ่งรอบ แล้วคืนค่าอัตโนมัติหลังรอบนั้น',
    expected: ['probe|A'],
    apply: async () => {
      const before = await getReport().catch(() => null);
      blockInternal('blipA')();
      await clearBlipAfterOneRound(isReport(before) ? before.round_id : null);
    },
    clear: async () => removeRules('probe-a', 'blipA'),
    isActive: () => taggedRules('probe-a', 'blipA').length > 0,
  },
  cutA: {
    name: 'cutA',
    label: 'A หลุดจากเครือข่ายทั้งหมด',
    how: 'ถอด Probe A ออกจากเครือข่ายภายใน — A ส่งผลไม่ได้',
    expected: ['insufficient'],
    apply: async () => must(docker(['network', 'disconnect', INNER, containerOf('probe-a')]), 'network disconnect'),
    clear: async () => {
      if (!FAULTS.cutA.isActive()) return;
      must(docker(['network', 'connect', '--ip', PROBE_A_IP, INNER, containerOf('probe-a')]), 'network connect');
      must(exec('probe-a', ['ip', 'route', 'replace', '10.77.2.0/24', 'via', '10.77.1.254']), 'restore route');
    },
    isActive: () => !probeAOnInner(),
  },
};

export function isFaultName(name: string): name is FaultName {
  return (FAULT_NAMES as readonly string[]).includes(name);
}

/** Expected Diagnosis keys for a set of active Faults (prototype `Lab.expected`). */
export function expectedKeys(active: Iterable<FaultName>): string[] {
  return [...new Set([...active].flatMap((f) => FAULTS[f].expected))].sort();
}

/** Applies a Fault; if that fails, undoes whatever part of it took effect and rethrows. */
export async function applyFault(name: FaultName): Promise<void> {
  try {
    await FAULTS[name].apply();
  } catch (e) {
    await FAULTS[name].clear().catch(() => undefined);
    throw e;
  }
}

export function activeFaults(): FaultName[] {
  return FAULT_NAMES.filter((n) => FAULTS[n].isActive());
}

/** Undoes every Fault. Idempotent; cutA first so Probe A is reachable for the rest. */
export async function clearAll(): Promise<void> {
  const order: FaultName[] = ['cutA', ...FAULT_NAMES.filter((n) => n !== 'cutA')];
  const errors: string[] = [];
  for (const name of order) {
    try {
      await FAULTS[name].clear();
    } catch (e) {
      errors.push(`${name}: ${(e as Error).message}`);
    }
  }
  if (errors.length) throw new Error(`clear failed for ${errors.join('; ')}`);
}
