// Seam 1 with real transport: the Collector service, its HTTP API and scheduler, against real
// Probe servers testing real loopback Targets (HTTP Internal Service, two HTTPS External Sites).
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { startCollectorService, type CollectorService, type ProbeClient } from '../../src/collector/index.ts';
import { startProbe, type RunningProbe } from '../../src/probe/server.ts';
import { loadConfig, type Config } from '../../src/shared/config.ts';
import type { NoDataReport, ProbeId, Report } from '../../src/shared/types.ts';
import { startFakeDns, type FakeDns } from '../support/fake-dns.ts';
import { makeTestCa, type TestCa } from '../support/test-ca.ts';
import { tempJsonlPath } from '../support/sim-lab.ts';

let tls: TestCa;
let dns: FakeDns;
let local: Server;
let siteX: Server;
let siteY: Server;
const probes: Partial<Record<ProbeId, RunningProbe>> = {};
let service: CollectorService | undefined;

const portOf = (s: Server) => (s.address() as AddressInfo).port;
const listen = (s: Server, port = 0) => new Promise<void>((resolve) => s.listen(port, '127.0.0.1', resolve));
const shut = (s: Server) => {
  s.closeAllConnections();
  return new Promise<void>((resolve) => s.close(() => resolve()));
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const httpsSite = () => createHttpsServer({ key: tls.key, cert: tls.validCert }, (_q, r) => r.end('ok'));

function config(overrides: Partial<Config> = {}): Config {
  const base = loadConfig('config/local.json');
  return {
    ...base,
    probes: { A: { url: probes.A!.url }, B: { url: probes.B!.url } },
    targets: {
      'local-service': { url: `http://127.0.0.1:${portOf(local)}/` },
      'site-x': { url: `https://x.fw.test:${portOf(siteX)}/`, ip: '127.0.0.1', port: portOf(siteX) },
      'site-y': { url: `https://y.fw.test:${portOf(siteY)}/`, ip: '127.0.0.1', port: portOf(siteY) },
    },
    timeouts: { http_ms: 800, dns_ms: 400, tcp_ms: 800, probe_call_ms: 2000 },
    results_jsonl: tempJsonlPath(),
    ...overrides,
  };
}

async function startProbeAt(id: ProbeId, port = 0): Promise<void> {
  // the Probe only needs the Targets; its own `probes` entry is not read
  probes[id] = await startProbe({ config: config(), probeId: id, port, host: '127.0.0.1', resolverServers: [dns.server], ca: tls.ca });
}

async function start(overrides: Partial<Config> = {}, opts: { schedule?: boolean; client?: ProbeClient } = {}) {
  service = await startCollectorService({ config: config(overrides), port: 0, host: '127.0.0.1', schedule: false, ...opts });
  return service;
}

async function get(path: string): Promise<Report | NoDataReport> {
  return (await (await fetch(`${service!.url}${path}`)).json()) as Report | NoDataReport;
}

async function post(path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${service!.url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const round = async () => (await post('/rounds')).json as Report;
const isReport = (r: Report | NoDataReport): r is Report => 'round_id' in r;

beforeAll(async () => {
  tls = makeTestCa();
  dns = await startFakeDns({ 'x.fw.test': '127.0.0.1', 'y.fw.test': '127.0.0.1' });
  local = createHttpServer((_q, r) => r.end('ok'));
  siteX = httpsSite();
  siteY = httpsSite();
  await Promise.all([listen(local), listen(siteX), listen(siteY)]);
  // Probes are started after the Targets so their config can name the Targets' ports
  probes.A = { url: 'http://127.0.0.1:1', close: async () => {} };
  probes.B = probes.A;
  await startProbeAt('A');
  await startProbeAt('B');
});

afterEach(async () => {
  await service?.close();
  service = undefined;
});

afterAll(async () => {
  await Promise.all([probes.A?.close(), probes.B?.close(), shut(local), shut(siteX), shut(siteY), dns.close()]);
});

describe('Collector service against real Probes', () => {
  it('answers no-data before the first Round, then a normal Diagnosis within one cadence', async () => {
    await start({ cadence_ms: 300 });
    expect(await get('/report')).toEqual({ status: 'no-data' });
    service!.scheduler.start();
    let report: Report | NoDataReport = { status: 'no-data' };
    for (let i = 0; i < 20 && !isReport(report); i++) {
      await sleep(100);
      report = await get('/report');
    }
    expect(isReport(report)).toBe(true);
    const r = report as Report;
    expect(r.keys).toEqual([]);
    expect(r.alert).toBe(false);
    expect(r.probes.map((p) => p.state)).toEqual(['reported', 'reported']);
    // healthy: HTTP only, no Follow-up Tests
    expect(r.tests_this_round).toBe(6);
    expect(r.tests_if_full_sweep).toBe(14);
    expect(r.results.every((x) => x.test === 'http' && x.success)).toBe(true);
  });

  it('POST /rounds runs a Round now, one id higher than the previous', async () => {
    await start();
    const first = await round();
    const second = await round();
    expect(second.round_id).toBe(first.round_id + 1);
    expect((await get('/report')) as Report).toMatchObject({ round_id: second.round_id });
  });

  it('reports no-data for a killed Probe and recovers when it restarts, without stopping', async () => {
    await start();
    expect((await round()).keys).toEqual([]);
    const port = Number(new URL(probes.B!.url).port);
    await probes.B!.close();
    const down = await round();
    expect(down.keys).toEqual(['insufficient']);
    expect(down.findings[0]).toMatchObject({ code: 'nodata' });
    expect(down.probes.find((p) => p.probe_id === 'B')!.state).toBe('silent');
    await startProbeAt('B', port);
    expect((await round()).keys).toEqual([]);
  });

  it('treats a Probe that answers garbage as silent', async () => {
    const liar = createHttpServer((_q, r) => r.end('{"probe_id":"B","results":[{"target":"mars"}]}'));
    await listen(liar);
    try {
      await start({ probes: { A: { url: probes.A!.url }, B: { url: `http://127.0.0.1:${portOf(liar)}` } } });
      const r = await round();
      expect(r.keys).toEqual(['insufficient']);
      expect(r.results.every((x) => x.probe_id === 'A')).toBe(true);
    } finally {
      await shut(liar);
    }
  });

  it('finds Site X faulty when its HTTPS server stops', async () => {
    await start();
    const port = portOf(siteX);
    await shut(siteX);
    try {
      await round();
      const r = await round();
      expect(r.keys).toEqual(['dest|site-x']);
      expect(r.alert).toBe(true);
      // Follow-up Tests ran for Site X only, on both Probes
      const followUps = r.results.filter((x) => x.test !== 'http');
      expect(new Set(followUps.map((x) => `${x.probe_id}|${x.target}|${x.test}`))).toEqual(
        new Set(['A|site-x|dns', 'A|site-x|tcp', 'B|site-x|dns', 'B|site-x|tcp']),
      );
    } finally {
      siteX = httpsSite();
      await listen(siteX, port);
    }
    expect((await round()).keys).toEqual([]);
  });

  it('pauses and resumes the schedule; Rounds never overlap', async () => {
    // a slow client: every Probe call takes longer than the cadence
    const live = { calls: 0, maxConcurrentRounds: 0 };
    const rounds = new Map<number, number>();
    const slow: ProbeClient = {
      async run(probeId, roundId, tests) {
        rounds.set(roundId, (rounds.get(roundId) ?? 0) + 1);
        const active = [...rounds.values()].filter((n) => n > 0).length;
        live.maxConcurrentRounds = Math.max(live.maxConcurrentRounds, active);
        live.calls++;
        await sleep(120);
        rounds.set(roundId, rounds.get(roundId)! - 1);
        return { probe_id: probeId, results: tests.map((t) => ({ ...t, success: true, duration_ms: 5, error_type: null })) };
      },
    };
    await start({ cadence_ms: 50 }, { client: slow });
    service!.scheduler.start();
    await Promise.all([round(), round(), sleep(400)]);
    expect(live.maxConcurrentRounds).toBe(1);

    expect((await post('/schedule', { paused: true })).json).toEqual({ paused: true });
    await sleep(200); // let a Round already in flight finish
    const before = ((await get('/report')) as Report).round_id;
    await sleep(400);
    expect(((await get('/report')) as Report).round_id).toBe(before);

    await post('/schedule', { paused: false });
    await sleep(400);
    expect(((await get('/report')) as Report).round_id).toBeGreaterThan(before);
    expect(live.maxConcurrentRounds).toBe(1);
  });

  it('rejects a malformed schedule request', async () => {
    await start();
    expect((await post('/schedule', { paused: 'yes' })).status).toBe(400);
  });

  it('POST /reset forgets stored Results so the next streak starts fresh', async () => {
    await start();
    const port = portOf(siteX);
    await shut(siteX);
    try {
      await round();
      expect((await round()).findings[0]!.rounds_seen).toBe(2);
      expect((await post('/reset')).json).toEqual({ reset: true });
      expect(await get('/report')).toEqual({ status: 'no-data' });
      const fresh = await round();
      expect(fresh.findings[0]).toMatchObject({ key: 'dest|site-x', rounds_seen: 1, evidence_level: 'initial' });
      expect(fresh.alert).toBe(false);
    } finally {
      siteX = httpsSite();
      await listen(siteX, port);
    }
  });

  it('serves the dashboard page at / and 404s unknown routes', async () => {
    await start();
    const page = await fetch(`${service!.url}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    expect((await fetch(`${service!.url}/nope`)).status).toBe(404);
  });
});
