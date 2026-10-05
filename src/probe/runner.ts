// The Probe test runner: runs HTTP, DNS and TCP tests against the Targets in its own config,
// concurrently, and reports what it measured. It never reads the wall clock (ADR 0003).
import { request as httpRequest, type ClientRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import type { Config } from '../shared/config.ts';
import type { ErrorType, ProbeResult, TestRequest } from '../shared/types.ts';
import { NameResolutionError, createNameResolver, type NameResolver } from './resolver.ts';

export interface RunnerOptions {
  config: Config;
  /** nameservers to resolve through; default: the system's */
  resolverServers?: string[];
  /** CA certificates to trust instead of Node's defaults (tests); the Lab uses NODE_EXTRA_CA_CERTS */
  ca?: string | Buffer | (string | Buffer)[];
}

export type RunTests = (tests: TestRequest[]) => Promise<ProbeResult[]>;

/** Codes Node and OpenSSL use when a peer certificate fails validation. */
const CERT_CODE = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|INVALID_CA|HOSTNAME_MISMATCH|PATH_LENGTH|INVALID_PURPOSE|UNABLE_TO_DECRYPT|UNABLE_TO_DECODE/;

class TimeoutError extends Error {
  override name = 'TimeoutError';
}

type Outcome = { success: true } | { success: false; error_type: ErrorType };

function classify(err: unknown): ErrorType {
  if (err instanceof TimeoutError) return 'timeout';
  if (err instanceof NameResolutionError) return err.failure;
  const code = (err as NodeJS.ErrnoException | undefined)?.code ?? '';
  if (CERT_CODE.test(code)) return 'tls_cert';
  // ECONNREFUSED, ECONNRESET, EHOSTUNREACH, socket hang up …: the connection could not be made or held.
  return 'refused';
}

function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, '');
}

function httpTest(url: URL, timeoutMs: number, resolver: NameResolver, ca: RunnerOptions['ca']): Promise<Outcome> {
  return new Promise<Outcome>((resolve) => {
    let req: ClientRequest | undefined = undefined;
    const done = (outcome: Outcome) => {
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => req?.destroy(new TimeoutError('http timeout')), timeoutMs);
    const onResponse = (res: IncomingMessage) => {
      const status = res.statusCode ?? 0;
      res.destroy();
      req?.destroy();
      done(status >= 200 && status < 400 ? { success: true } : { success: false, error_type: 'http_status' });
    };
    const options = {
      method: 'GET',
      // A fresh agent per test: a new connection and a new TLS session every time.
      // Pooled connections or resumed sessions would skip certificate checks.
      agent: false as const,
      lookup: resolver.lookup,
      headers: { 'user-agent': 'FaultWitness-Probe', connection: 'close' },
    };
    req =
      url.protocol === 'https:'
        ? httpsRequest(url, { ...options, ...(ca ? { ca } : {}) }, onResponse)
        : httpRequest(url, options, onResponse);
    req.on('error', (err) => done({ success: false, error_type: classify(err) }));
    req.end();
  });
}

function dnsTest(hostname: string, resolver: NameResolver): Promise<Outcome> {
  return resolver.resolve(hostname).then(
    () => ({ success: true }),
    (err: unknown) => ({ success: false, error_type: classify(err) }),
  );
}

function tcpTest(ip: string, port: number, timeoutMs: number): Promise<Outcome> {
  return new Promise<Outcome>((resolve) => {
    const socket = connect({ host: ip, port });
    const finish = (outcome: Outcome) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ success: false, error_type: 'timeout' }), timeoutMs);
    socket.once('connect', () => finish({ success: true }));
    socket.once('error', (err) => finish({ success: false, error_type: classify(err) }));
  });
}

/** Whether this Probe's config allows `test` against `target` (TCP needs a configured IP and port). */
export function isAllowed({ target, test }: TestRequest, config: Config): boolean {
  if (!Object.hasOwn(config.targets, target)) return false;
  if (test === 'tcp') return target !== 'local-service';
  return true;
}

export function createRunner({ config, resolverServers, ca }: RunnerOptions): RunTests {
  const resolver = createNameResolver({ timeoutMs: config.timeouts.dns_ms, servers: resolverServers });

  function measure(t: TestRequest): Promise<Outcome> {
    const url = new URL(config.targets[t.target].url);
    switch (t.test) {
      case 'http':
        return httpTest(url, config.timeouts.http_ms, resolver, ca);
      case 'dns':
        return dnsTest(hostOf(url), resolver);
      case 'tcp': {
        if (t.target === 'local-service') throw new Error('tcp is not configured for local-service');
        const { ip, port } = config.targets[t.target];
        return tcpTest(ip, port, config.timeouts.tcp_ms);
      }
    }
  }

  async function runOne(t: TestRequest): Promise<ProbeResult> {
    const start = performance.now();
    const outcome = await measure(t);
    const duration_ms = Math.round(performance.now() - start);
    return {
      target: t.target,
      test: t.test,
      success: outcome.success,
      duration_ms,
      error_type: outcome.success ? null : outcome.error_type,
    };
  }

  return (tests) => Promise.all(tests.map(runOne));
}
