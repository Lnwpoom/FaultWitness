// Thin wrappers over the docker CLI for the Lab. Everything runs against lab/compose.yaml.
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LAB_DIR = dirname(fileURLToPath(import.meta.url));
const COMPOSE = ['compose', '-f', join(LAB_DIR, 'compose.yaml'), '--profile', 'tools'];

/** Build through the host network when the host reaches package mirrors via a local proxy (the build sandbox). */
function buildEnv(): NodeJS.ProcessEnv {
  const proxy = process.env.http_proxy ?? process.env.https_proxy ?? '';
  const local = /\/\/(127\.0\.0\.1|localhost)[:/]/.test(proxy);
  return { ...process.env, LAB_BUILD_NETWORK: process.env.LAB_BUILD_NETWORK ?? (local ? 'host' : 'default') };
}

export interface RunResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

function result(r: SpawnSyncReturns<string>): RunResult {
  return { ok: r.status === 0, code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error?.message ?? '') };
}

/** Runs `docker <args>` and captures its output. */
export function docker(args: string[], timeoutMs = 120_000): RunResult {
  return result(spawnSync('docker', args, { encoding: 'utf8', timeout: timeoutMs, env: buildEnv() }));
}

/** Runs `docker compose <args>` for the Lab and captures its output. */
export function compose(args: string[], timeoutMs = 120_000): RunResult {
  return docker([...COMPOSE, ...args], timeoutMs);
}

/** Runs `docker compose <args>` with output going straight to the terminal. */
export function composeLive(args: string[], timeoutMs = 900_000): boolean {
  const r = spawnSync('docker', [...COMPOSE, ...args], { stdio: 'inherit', timeout: timeoutMs, env: buildEnv() });
  return r.status === 0;
}

/** Runs a command inside a Lab service's container. */
export function exec(service: string, cmd: string[], timeoutMs = 30_000): RunResult {
  return compose(['exec', '-T', service, ...cmd], timeoutMs);
}

/** Starts a command inside a Lab service without waiting; resolves with its output when it exits. */
export function execAsync(service: string, cmd: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    const p = spawn('docker', [...COMPOSE, 'exec', '-T', service, ...cmd], { env: buildEnv() });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    p.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    p.on('close', (code) => resolve({ ok: code === 0, code: code ?? -1, stdout, stderr }));
  });
}

/** The container name of a Lab service, e.g. for `docker network disconnect`. */
export function containerOf(service: string): string {
  return compose(['ps', '-a', '-q', service]).stdout.trim();
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
