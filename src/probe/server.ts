// The Probe's HTTP server: `POST /run` runs the Collector's tests, `GET /health` names the Probe.
// Only Targets and tests from the Probe's own config are accepted (400 otherwise), so the Probe
// cannot be used to reach arbitrary hosts.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Config } from '../shared/config.ts';
import {
  TARGET_IDS,
  TEST_KINDS,
  type HealthResponse,
  type ProbeId,
  type RunRequest,
  type RunResponse,
  type TestRequest,
} from '../shared/types.ts';
import { createRunner, isAllowed, type RunnerOptions } from './runner.ts';

export interface ProbeOptions {
  config: Config;
  probeId: ProbeId;
  /** default 0 (any free port) */
  port?: number;
  /** default 127.0.0.1 */
  host?: string;
  /** nameservers to resolve through; default: the system's */
  resolverServers?: string[];
  /** CA certificates to trust instead of Node's defaults */
  ca?: RunnerOptions['ca'];
}

export interface RunningProbe {
  /** base URL, e.g. `http://127.0.0.1:7101` */
  url: string;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TESTS = 64;

class BadRequest extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new BadRequest('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isTestRequest(v: unknown): v is TestRequest {
  if (typeof v !== 'object' || v === null) return false;
  const { target, test } = v as Record<string, unknown>;
  return (
    (TARGET_IDS as readonly unknown[]).includes(target) && (TEST_KINDS as readonly unknown[]).includes(test)
  );
}

/** Validates a `POST /run` body against the contract and this Probe's config. */
function parseRunRequest(text: string, config: Config): RunRequest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BadRequest('body is not JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new BadRequest('body must be an object');
  const { round_id, tests } = raw as Record<string, unknown>;
  if (typeof round_id !== 'number' || !Number.isInteger(round_id)) throw new BadRequest('round_id must be an integer');
  if (!Array.isArray(tests) || tests.length > MAX_TESTS) throw new BadRequest(`tests must be an array of at most ${MAX_TESTS}`);
  for (const t of tests) {
    if (!isTestRequest(t) || !isAllowed(t, config)) throw new BadRequest(`test not allowed by config: ${JSON.stringify(t)}`);
  }
  return { round_id, tests: tests.map(({ target, test }: TestRequest) => ({ target, test })) };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

export async function startProbe({
  config,
  probeId,
  port = 0,
  host = '127.0.0.1',
  resolverServers,
  ca,
}: ProbeOptions): Promise<RunningProbe> {
  const runTests = createRunner({ config, resolverServers, ca });

  const server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://probe').pathname;
    if (req.method === 'GET' && path === '/health') {
      send(res, 200, { probe_id: probeId } satisfies HealthResponse);
      return;
    }
    if (req.method === 'POST' && path === '/run') {
      readBody(req)
        .then((text) => runTests(parseRunRequest(text, config).tests))
        .then(
          (results) => send(res, 200, { probe_id: probeId, results } satisfies RunResponse),
          (err: unknown) => {
            if (err instanceof BadRequest) send(res, 400, { error: err.message });
            else send(res, 500, { error: 'internal error' });
          },
        );
      return;
    }
    send(res, 404, { error: 'not found' });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const shownHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;

  return {
    url: `http://${shownHost}:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
