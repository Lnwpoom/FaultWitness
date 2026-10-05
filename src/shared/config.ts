import { readFileSync } from 'node:fs';
import { EXTERNAL_SITES, PROBE_IDS, type ExternalSiteId, type ProbeId } from './types.ts';

export interface ProbeConfig {
  url: string;
}

export interface InternalTargetConfig {
  url: string;
}

export interface ExternalTargetConfig {
  url: string;
  /** fixed IP used by the TCP Follow-up Test */
  ip: string;
  port: number;
}

export interface Timeouts {
  http_ms: number;
  dns_ms: number;
  tcp_ms: number;
  /** how long the Collector waits for a Probe's `POST /run` */
  probe_call_ms: number;
}

export interface Config {
  collector: { port: number };
  probes: Record<ProbeId, ProbeConfig>;
  targets: { 'local-service': InternalTargetConfig } & Record<ExternalSiteId, ExternalTargetConfig>;
  cadence_ms: number;
  stale_after_ms: number;
  timeouts: Timeouts;
  /** append-only file of every Result the Collector stores */
  results_jsonl: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function obj(parent: Obj, key: string, path: string): Obj {
  const v = parent[key];
  if (!isObj(v)) throw new ConfigError(`config: "${path}" is missing or not an object`);
  return v;
}

function str(parent: Obj, key: string, path: string): string {
  const v = parent[key];
  if (typeof v !== 'string' || v === '') throw new ConfigError(`config: "${path}" is missing or not a non-empty string`);
  return v;
}

function num(parent: Obj, key: string, path: string): number {
  const v = parent[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
    throw new ConfigError(`config: "${path}" is missing or not a positive number`);
  }
  return v;
}

function url(parent: Obj, key: string, path: string, protocols: string[]): string {
  const v = str(parent, key, path);
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    throw new ConfigError(`config: "${path}" is not a valid URL: ${v}`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new ConfigError(`config: "${path}" must use ${protocols.join(' or ')}: ${v}`);
  }
  return v;
}

/** Validates an already-parsed config object, throwing a ConfigError that names the offending field. */
export function parseConfig(raw: unknown): Config {
  if (!isObj(raw)) throw new ConfigError('config: top level must be a JSON object');

  const collector = obj(raw, 'collector', 'collector');
  const probesRaw = obj(raw, 'probes', 'probes');
  const probes = {} as Record<ProbeId, ProbeConfig>;
  for (const id of PROBE_IDS) {
    const p = obj(probesRaw, id, `probes.${id}`);
    probes[id] = { url: url(p, 'url', `probes.${id}.url`, ['http:']) };
  }

  const targetsRaw = obj(raw, 'targets', 'targets');
  const local = obj(targetsRaw, 'local-service', 'targets.local-service');
  const external = {} as Record<ExternalSiteId, ExternalTargetConfig>;
  for (const id of EXTERNAL_SITES) {
    const t = obj(targetsRaw, id, `targets.${id}`);
    external[id] = {
      url: url(t, 'url', `targets.${id}.url`, ['https:', 'http:']),
      ip: str(t, 'ip', `targets.${id}.ip`),
      port: num(t, 'port', `targets.${id}.port`),
    };
  }

  const timeouts = obj(raw, 'timeouts', 'timeouts');
  return {
    collector: { port: num(collector, 'port', 'collector.port') },
    probes,
    targets: { 'local-service': { url: url(local, 'url', 'targets.local-service.url', ['http:', 'https:']) }, ...external },
    cadence_ms: num(raw, 'cadence_ms', 'cadence_ms'),
    stale_after_ms: num(raw, 'stale_after_ms', 'stale_after_ms'),
    timeouts: {
      http_ms: num(timeouts, 'http_ms', 'timeouts.http_ms'),
      dns_ms: num(timeouts, 'dns_ms', 'timeouts.dns_ms'),
      tcp_ms: num(timeouts, 'tcp_ms', 'timeouts.tcp_ms'),
      probe_call_ms: num(timeouts, 'probe_call_ms', 'timeouts.probe_call_ms'),
    },
    results_jsonl: str(raw, 'results_jsonl', 'results_jsonl'),
  };
}

/** Reads and validates the config file at `path` (default: $FAULTWITNESS_CONFIG or config/local.json). */
export function loadConfig(path = process.env.FAULTWITNESS_CONFIG ?? 'config/local.json'): Config {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    throw new ConfigError(`config: cannot read ${path}: ${(e as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`config: ${path} is not valid JSON: ${(e as Error).message}`);
  }
  return parseConfig(raw);
}
