// Seam 2: the Probe's POST /run against real loopback servers started here.
import { createServer as createHttpServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { createServer as createTcpServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type Config } from '../../src/shared/config.ts';
import type { ProbeResult, RunResponse, TestRequest } from '../../src/shared/types.ts';
import { startProbe } from '../../src/probe/server.ts';
import { startFakeDns, type FakeDns } from '../support/fake-dns.ts';
import { makeTestCa, type TestCa } from '../support/test-ca.ts';

const HTTP_MS = 600;
const DNS_MS = 300;
const TCP_MS = 600;

let tls: TestCa;
let dns: FakeDns;
const closers: (() => unknown)[] = [];

function portOf(server: { address(): AddressInfo | string | null }): number {
  return (server.address() as AddressInfo).port;
}

async function listen<S extends Server | ReturnType<typeof createTcpServer>>(server: S): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(() => {
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    server.close();
  });
  return portOf(server);
}

/**
 * An HTTPS server answering 200; `swap` changes its certificate for later handshakes but keeps its
 * session ticket keys, so a client that resumed a TLS session would never see the new certificate.
 */
async function httpsServer(cert: string): Promise<{ port: number; swap(cert: string): void }> {
  const server = createHttpsServer({ key: tls.key, cert }, (_req, res) => res.end('ok'));
  const port = await listen(server);
  const swap = (next: string) => {
    const ticketKeys = server.getTicketKeys();
    server.setSecureContext({ key: tls.key, cert: next });
    server.setTicketKeys(ticketKeys);
  };
  return { port, swap };
}

function httpServer(status: number, headers: Record<string, string> = {}): Promise<number> {
  return listen(createHttpServer((_req, res) => res.writeHead(status, headers).end('body')));
}

/** Accepts connections and never says anything. */
function silentServer(): Promise<number> {
  const sockets: Socket[] = [];
  const server = createTcpServer((s) => sockets.push(s));
  closers.push(() => sockets.forEach((s) => s.destroy()));
  return listen(server);
}

/** A port with nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = portOf(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

type TargetUrls = Partial<Record<'local-service' | 'site-x' | 'site-y', string>>;
type TargetTcp = Partial<Record<'site-x' | 'site-y', number>>;

function configWith(urls: TargetUrls, tcpPorts: TargetTcp = {}): Config {
  const base = loadConfig('config/local.json');
  return {
    ...base,
    targets: {
      'local-service': { url: urls['local-service'] ?? 'http://127.0.0.1:1/' },
      'site-x': { url: urls['site-x'] ?? 'https://x.fw.test:1/', ip: '127.0.0.1', port: tcpPorts['site-x'] ?? 1 },
      'site-y': { url: urls['site-y'] ?? 'https://y.fw.test:1/', ip: '127.0.0.1', port: tcpPorts['site-y'] ?? 1 },
    },
    timeouts: { http_ms: HTTP_MS, dns_ms: DNS_MS, tcp_ms: TCP_MS, probe_call_ms: 5000 },
  };
}

async function probeFor(config: Config, probeId: 'A' | 'B' = 'A'): Promise<string> {
  const probe = await startProbe({ config, probeId, port: 0, host: '127.0.0.1', resolverServers: [dns.server], ca: tls.ca });
  closers.push(() => probe.close());
  return probe.url;
}

async function post(url: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${url}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) as unknown };
  } catch {
    return { status: res.status, json: text };
  }
}

async function run(config: Config, tests: TestRequest[]): Promise<ProbeResult[]> {
  const { status, json } = await post(await probeFor(config), { round_id: 1, tests });
  expect(status).toBe(200);
  return (json as RunResponse).results;
}

async function runOne(config: Config, test: TestRequest): Promise<ProbeResult> {
  const [result] = await run(config, [test]);
  if (!result) throw new Error('no result');
  return result;
}

beforeAll(async () => {
  tls = makeTestCa();
  dns = await startFakeDns({
    'x.fw.test': '127.0.0.1',
    'y.fw.test': '127.0.0.1',
    'swap.fw.test': '127.0.0.1',
    'silent.fw.test': 'silent',
  });
  closers.push(() => dns.close());
});

afterAll(async () => {
  await Promise.all(closers.map((close) => close()));
});

describe('Probe POST /run: http', () => {
  it('passes HTTPS to a server whose certificate comes from a trusted CA', async () => {
    const site = await httpsServer(tls.validCert);
    const result = await runOne(configWith({ 'site-x': `https://x.fw.test:${site.port}/` }), { target: 'site-x', test: 'http' });
    expect(result).toMatchObject({ target: 'site-x', test: 'http', success: true, error_type: null });
    expect(Number.isInteger(result.duration_ms)).toBe(true);
  });

  it('fails HTTPS with tls_cert when the certificate has expired', async () => {
    const site = await httpsServer(tls.expiredCert);
    const result = await runOne(configWith({ 'site-x': `https://x.fw.test:${site.port}/` }), { target: 'site-x', test: 'http' });
    expect(result).toMatchObject({ success: false, error_type: 'tls_cert' });
  });

  it('fails HTTPS with tls_cert when the certificate does not cover the hostname', async () => {
    const site = await httpsServer(tls.validCert);
    const result = await runOne(configWith({ 'site-x': `https://localhost:${site.port}/` }), { target: 'site-x', test: 'http' });
    expect(result).toMatchObject({ success: false, error_type: 'tls_cert' });
  });

  it('detects a certificate swapped to an expired one between two requests to the same host', async () => {
    const site = await httpsServer(tls.validCert);
    const config = configWith({ 'site-x': `https://swap.fw.test:${site.port}/` });
    const url = await probeFor(config);
    const first = await post(url, { round_id: 1, tests: [{ target: 'site-x', test: 'http' }] });
    expect((first.json as RunResponse).results[0]).toMatchObject({ success: true });

    site.swap(tls.expiredCert);
    const second = await post(url, { round_id: 2, tests: [{ target: 'site-x', test: 'http' }] });
    expect((second.json as RunResponse).results[0]).toMatchObject({ success: false, error_type: 'tls_cert' });
  });

  it('fails with http_status when the server answers 500', async () => {
    const port = await httpServer(500);
    const result = await runOne(configWith({ 'local-service': `http://127.0.0.1:${port}/` }), { target: 'local-service', test: 'http' });
    expect(result).toMatchObject({ success: false, error_type: 'http_status' });
  });

  it('passes on a redirect without following it', async () => {
    const port = await httpServer(301, { location: 'http://127.0.0.1:1/never-followed' });
    const result = await runOne(configWith({ 'local-service': `http://127.0.0.1:${port}/` }), { target: 'local-service', test: 'http' });
    expect(result).toMatchObject({ success: true, error_type: null });
  });

  it('fails with refused when nothing listens on the port', async () => {
    const port = await closedPort();
    const result = await runOne(configWith({ 'local-service': `http://localhost:${port}/` }), { target: 'local-service', test: 'http' });
    expect(result).toMatchObject({ success: false, error_type: 'refused' });
  });

  it('fails with timeout, at the HTTP timeout, when the server accepts but never answers', async () => {
    const port = await silentServer();
    const result = await runOne(configWith({ 'site-y': `https://y.fw.test:${port}/` }), { target: 'site-y', test: 'http' });
    expect(result).toMatchObject({ success: false, error_type: 'timeout' });
    expect(result.duration_ms).toBeGreaterThanOrEqual(HTTP_MS - 20);
    expect(result.duration_ms).toBeLessThan(HTTP_MS + 300);
  });
});

describe('Probe POST /run: name resolution', () => {
  it('passes DNS for a name the resolver knows', async () => {
    const result = await runOne(configWith({ 'site-x': 'https://x.fw.test/' }), { target: 'site-x', test: 'dns' });
    expect(result).toMatchObject({ target: 'site-x', test: 'dns', success: true, error_type: null });
  });

  it('fails both DNS and HTTP with dns_error for a name that does not exist', async () => {
    const config = configWith({ 'site-y': 'https://nowhere.fw.test/' });
    const results = await run(config, [
      { target: 'site-y', test: 'dns' },
      { target: 'site-y', test: 'http' },
    ]);
    expect(results).toMatchObject([
      { test: 'dns', success: false, error_type: 'dns_error' },
      { test: 'http', success: false, error_type: 'dns_error' },
    ]);
  });

  it('fails both DNS and HTTP with dns_timeout, at the DNS timeout, when the resolver never answers', async () => {
    const config = configWith({ 'site-x': 'https://silent.fw.test/' });
    const results = await run(config, [
      { target: 'site-x', test: 'dns' },
      { target: 'site-x', test: 'http' },
    ]);
    expect(results).toMatchObject([
      { test: 'dns', success: false, error_type: 'dns_timeout' },
      { test: 'http', success: false, error_type: 'dns_timeout' },
    ]);
    for (const r of results) {
      expect(r.duration_ms).toBeGreaterThanOrEqual(DNS_MS - 20);
      expect(r.duration_ms).toBeLessThan(DNS_MS + 300);
    }
  });

  it('fails DNS and HTTP together when no nameserver is reachable', async () => {
    const deadDns = `127.0.0.1:${await closedPort()}`;
    const config = configWith({ 'site-x': 'https://x.fw.test/' });
    const probe = await startProbe({ config, probeId: 'B', resolverServers: [deadDns], ca: tls.ca });
    closers.push(() => probe.close());
    const { json } = await post(probe.url, {
      round_id: 3,
      tests: [
        { target: 'site-x', test: 'dns' },
        { target: 'site-x', test: 'http' },
      ],
    });
    const results = (json as RunResponse).results;
    expect(results.map((r) => r.success)).toEqual([false, false]);
    for (const r of results) expect(['dns_error', 'dns_timeout']).toContain(r.error_type);
  });

  it('treats an IP-literal URL as resolved without asking DNS', async () => {
    const result = await runOne(configWith({ 'local-service': 'http://127.0.0.1:1/' }), { target: 'local-service', test: 'dns' });
    expect(result).toMatchObject({ success: true, error_type: null });
  });
});

describe('Probe POST /run: tcp', () => {
  it("passes when the Target's configured IP and port accept a connection", async () => {
    const port = await silentServer();
    const result = await runOne(configWith({}, { 'site-x': port }), { target: 'site-x', test: 'tcp' });
    expect(result).toMatchObject({ target: 'site-x', test: 'tcp', success: true, error_type: null });
  });

  it('fails with refused when the configured port is closed', async () => {
    const port = await closedPort();
    const result = await runOne(configWith({}, { 'site-y': port }), { target: 'site-y', test: 'tcp' });
    expect(result).toMatchObject({ success: false, error_type: 'refused' });
  });
});

describe('Probe POST /run: one request', () => {
  it('answers with its Probe id and one Result per test, in request order', async () => {
    const port = await httpServer(200);
    const url = await probeFor(configWith({ 'local-service': `http://127.0.0.1:${port}/` }), 'B');
    const { status, json } = await post(url, {
      round_id: 7,
      tests: [
        { target: 'local-service', test: 'http' },
        { target: 'local-service', test: 'dns' },
      ],
    });
    expect(status).toBe(200);
    expect(json).toMatchObject({
      probe_id: 'B',
      results: [
        { target: 'local-service', test: 'http', success: true },
        { target: 'local-service', test: 'dns', success: true },
      ],
    });
  });

  it('runs the tests concurrently: three timeouts take about one timeout, not three', async () => {
    const port = await silentServer();
    const config = configWith({
      'local-service': `http://127.0.0.1:${port}/`,
      'site-x': `https://x.fw.test:${port}/`,
      'site-y': `https://y.fw.test:${port}/`,
    });
    const url = await probeFor(config);
    const started = performance.now();
    const { json } = await post(url, {
      round_id: 1,
      tests: [
        { target: 'local-service', test: 'http' },
        { target: 'site-x', test: 'http' },
        { target: 'site-y', test: 'http' },
        { target: 'site-x', test: 'dns' },
      ],
    });
    const elapsed = performance.now() - started;
    expect((json as RunResponse).results.map((r) => r.error_type)).toEqual(['timeout', 'timeout', 'timeout', null]);
    expect(elapsed).toBeLessThan(2 * HTTP_MS);
  });
});

describe('Probe POST /run: allowlist', () => {
  const rejected: [string, unknown][] = [
    ['a Target not in the config', { round_id: 1, tests: [{ target: 'evil.example', test: 'http' }] }],
    ['a URL instead of a Target id', { round_id: 1, tests: [{ target: 'http://169.254.169.254/', test: 'http' }] }],
    ['an unknown test kind', { round_id: 1, tests: [{ target: 'site-x', test: 'icmp' }] }],
    ['TCP to the Internal Service, which has no configured IP and port', { round_id: 1, tests: [{ target: 'local-service', test: 'tcp' }] }],
    ['a body without round_id', { tests: [] }],
    ['a body whose tests is not a list', { round_id: 1, tests: 'all' }],
    ['a body that is not JSON', '{ nope'],
  ];

  it.each(rejected)('returns 400 for %s', async (_name, body) => {
    const url = await probeFor(configWith({}));
    const { status } = await post(url, body);
    expect(status).toBe(400);
  });

  it('runs nothing when any test in the request is not allowed', async () => {
    let hits = 0;
    const port = await listen(createHttpServer((_req, res) => {
      hits += 1;
      res.end('ok');
    }));
    const url = await probeFor(configWith({ 'local-service': `http://127.0.0.1:${port}/` }));
    const { status } = await post(url, {
      round_id: 1,
      tests: [
        { target: 'local-service', test: 'http' },
        { target: 'elsewhere', test: 'http' },
      ],
    });
    expect(status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(hits).toBe(0);
  });
});

describe('Probe HTTP API', () => {
  it('names the Probe on GET /health', async () => {
    const url = await probeFor(configWith({}), 'B');
    const res = await fetch(`${url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ probe_id: 'B' });
  });

  it('returns 404 for anything else', async () => {
    const url = await probeFor(configWith({}));
    expect((await fetch(`${url}/run`)).status).toBe(404);
    expect((await fetch(`${url}/nope`)).status).toBe(404);
  });
});
