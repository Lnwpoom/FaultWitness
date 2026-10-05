// The Collector as a service: the HTTP API, the dashboard page and the scheduler around one
// Collector. Rounds from the scheduler and from `POST /rounds` run one at a time.
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readBody, sendJson } from '../shared/http.ts';
import type { AddressInfo } from 'node:net';
import type { Config } from '../shared/config.ts';
import type { NoDataReport, Report } from '../shared/types.ts';
import { createCollector, type Collector } from './collector.ts';
import { createHttpProbeClient } from './http-probe-client.ts';
import { systemClock, type Clock, type ProbeClient } from './ports.ts';
import { createResultStore } from './result-store.ts';
import { createScheduler, type Scheduler } from './scheduler.ts';

export interface CollectorServiceOptions {
  config: Config;
  /** default: the HTTP adapter for `config.probes` */
  client?: ProbeClient;
  clock?: Clock;
  /** default: `config.collector.port`; 0 picks a free port */
  port?: number;
  host?: string;
  /** start the scheduler at once (default true) */
  schedule?: boolean;
  /** the dashboard page served at `GET /` */
  dashboardPath?: string | URL;
  log?: (line: string) => void;
}

export interface CollectorService {
  url: string;
  collector: Collector;
  scheduler: Scheduler;
  /** runs a Round after any Round already in progress */
  runRound(): Promise<Report | null>;
  close(): Promise<void>;
}

const DASHBOARD = new URL('../dashboard/index.html', import.meta.url);
const NO_DATA: NoDataReport = { status: 'no-data' };
const MAX_BODY_BYTES = 64 * 1024;

export async function startCollectorService(opts: CollectorServiceOptions): Promise<CollectorService> {
  const { config, clock = systemClock, host = '0.0.0.0', log = () => {} } = opts;
  const client = opts.client ?? createHttpProbeClient({ probes: config.probes, timeoutMs: config.timeouts.probe_call_ms });
  const store = createResultStore({ path: config.results_jsonl, clock });
  const collector = createCollector({ client, store, clock, staleAfterMs: config.stale_after_ms });

  let inFlight = 0;
  let chain: Promise<unknown> = Promise.resolve();
  function runRound(): Promise<Report | null> {
    inFlight++;
    const round = chain.then(() => collector.runRound());
    chain = round.catch(() => undefined).finally(() => inFlight--);
    return round.then((r) => {
      if (r) log(`round ${r.round_id}: ${r.overall}${r.alert ? ' [alert]' : ''} (${r.tests_this_round}/${r.tests_if_full_sweep} tests)`);
      return r;
    });
  }

  const scheduler = createScheduler({
    intervalMs: config.cadence_ms,
    tick: runRound,
    busy: () => inFlight > 0,
    onError: (e) => log(`round failed: ${(e as Error).message}`),
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://collector').pathname;
    const route = `${req.method} ${path}`;
    switch (route) {
      case 'GET /':
      case 'GET /index.html': {
        const html = await readFile(opts.dashboardPath ?? DASHBOARD, 'utf8').catch(
          () => '<!doctype html><meta charset="utf-8"><title>FaultWitness</title><p>ยังไม่มีหน้า Dashboard — ดู <a href="/report">/report</a></p>',
        );
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(html);
        return;
      }
      case 'GET /report':
        return sendJson(res, 200, collector.report() ?? NO_DATA);
      case 'POST /rounds':
        return sendJson(res, 200, (await runRound()) ?? NO_DATA);
      case 'POST /schedule': {
        let paused: unknown;
        try {
          paused = (JSON.parse(await readBody(req, MAX_BODY_BYTES)) as { paused?: unknown }).paused;
        } catch {
          return sendJson(res, 400, { error: 'body must be JSON like {"paused": true}' });
        }
        if (typeof paused !== 'boolean') return sendJson(res, 400, { error: '"paused" must be true or false' });
        scheduler.setPaused(paused);
        log(paused ? 'schedule paused' : 'schedule resumed');
        return sendJson(res, 200, { paused });
      }
      case 'POST /reset':
        await chain; // never reset under a Round that is still writing
        collector.reset();
        log('results reset');
        return sendJson(res, 200, { reset: true });
      default:
        return sendJson(res, 404, { error: `no route ${route}` });
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: (e as Error).message });
      else res.destroy();
    });
  });
  await new Promise<void>((resolve) => server.listen(opts.port ?? config.collector.port, host, resolve));
  const { port } = server.address() as AddressInfo;
  if (opts.schedule ?? true) scheduler.start();

  return {
    url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`,
    collector,
    scheduler,
    runRound,
    async close() {
      scheduler.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await chain;
    },
  };
}
