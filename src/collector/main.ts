// Entry point of the Collector: `node src/collector/main.ts`. Reads the shared config
// ($FAULTWITNESS_CONFIG or config/local.json), serves the API and dashboard on
// `collector.port` and runs a Round every `cadence_ms`.
import { loadConfig } from '../shared/config.ts';
import { startCollectorService } from './service.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const service = await startCollectorService({ config, log: (line) => console.log(`collector: ${line}`) });
  console.log(`collector listening on ${service.url} (Round every ${config.cadence_ms} ms)`);
  const stop = () => {
    service.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err: unknown) => {
  console.error(`collector: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
