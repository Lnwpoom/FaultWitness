// The Collector's HTTP API as the host sees it (published port 8080).
import type { NoDataReport, Report } from '../src/shared/types.ts';

export const COLLECTOR_URL = process.env.LAB_COLLECTOR_URL ?? 'http://localhost:8080';

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${COLLECTOR_URL}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const getReport = () => call<Report | NoDataReport>('GET', '/report');
export const runRoundNow = () => call<Report | NoDataReport>('POST', '/rounds');
export const setPaused = (paused: boolean) => call<unknown>('POST', '/schedule', { paused });
export const resetCollector = () => call<unknown>('POST', '/reset');

export function isReport(r: Report | NoDataReport | null): r is Report {
  return r !== null && 'round_id' in r;
}
