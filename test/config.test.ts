import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseConfig } from '../src/shared/config.ts';

const example = () => JSON.parse(JSON.stringify(loadConfig('config/local.json')));

describe('config loader', () => {
  it('accepts the example config', () => {
    const c = loadConfig('config/local.json');
    expect(c.probes.A.url).toBe('http://127.0.0.1:7101');
    expect(c.targets['site-x'].ip).toBe('1.1.1.1');
    expect(c.cadence_ms).toBe(10000);
    expect(c.stale_after_ms).toBe(25000);
    expect(c.timeouts).toEqual({ http_ms: 3000, dns_ms: 2000, tcp_ms: 3000, probe_call_ms: 5000 });
  });

  it('accepts the Lab config', () => {
    expect(loadConfig('lab/config.json').probes.B.url).toMatch(/^http:/);
  });

  it('rejects a missing Target, naming it', () => {
    const raw = example();
    delete raw.targets['site-y'];
    expect(() => parseConfig(raw)).toThrow(/targets\.site-y/);
  });

  it('rejects an External Site without an IP, naming the field', () => {
    const raw = example();
    delete raw.targets['site-x'].ip;
    expect(() => parseConfig(raw)).toThrow(/targets\.site-x\.ip/);
  });

  it('rejects a non-numeric timeout, naming the field', () => {
    const raw = example();
    raw.timeouts.dns_ms = '2000';
    expect(() => parseConfig(raw)).toThrow(/timeouts\.dns_ms/);
  });

  it('rejects a missing Probe, naming it', () => {
    const raw = example();
    delete raw.probes.B;
    expect(() => parseConfig(raw)).toThrow(/probes\.B/);
  });

  it('reports unreadable and malformed files clearly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fw-config-'));
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{ not json');
    expect(() => loadConfig(bad)).toThrow(/not valid JSON/);
    expect(() => loadConfig(join(dir, 'missing.json'))).toThrow(/cannot read/);
  });
});
