// Entry point of a Probe process: `PROBE_ID=A node src/probe/main.ts`.
// Reads the shared config ($FAULTWITNESS_CONFIG or config/local.json) and listens on 0.0.0.0
// at the port of its own `probes.<id>.url`.
import { loadConfig } from '../shared/config.ts';
import { PROBE_IDS, type ProbeId } from '../shared/types.ts';
import { startProbe } from './server.ts';

function probeIdFromEnv(value: string | undefined): ProbeId {
  const id = PROBE_IDS.find((p) => p === value);
  if (!id) throw new Error(`PROBE_ID must be one of ${PROBE_IDS.join(', ')}; got ${JSON.stringify(value ?? null)}`);
  return id;
}

function portOf(url: string): number {
  const parsed = new URL(url);
  return parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80;
}

async function main(): Promise<void> {
  const probeId = probeIdFromEnv(process.env.PROBE_ID);
  const config = loadConfig();
  const port = portOf(config.probes[probeId].url);
  const probe = await startProbe({ config, probeId, port, host: '0.0.0.0' });
  console.log(`probe ${probeId} listening on ${probe.url}`);

  const stop = () => {
    probe.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err: unknown) => {
  console.error(`probe: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
