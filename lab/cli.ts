// The `lab` CLI: `npm run lab -- <command>`. Brings the Lab up and down and checks it.
import { compose, composeLive } from './docker.ts';
import { selfcheck } from './selfcheck.ts';

const USAGE = `usage: npm run lab -- <command>

  up          build and start the Lab (ห้องแล็บ)
  down        stop the Lab and remove its containers and networks
  status      show the Lab's containers
  selfcheck   verify routing, naming, certificates and faketime from a Probe-like container`;

async function main(argv: string[]): Promise<number> {
  const [cmd] = argv;
  switch (cmd) {
    case 'up':
      return composeLive(['up', '-d', '--build', '--wait']) ? 0 : 1;
    case 'down':
      return composeLive(['down', '--remove-orphans', '--volumes']) ? 0 : 1;
    case 'status': {
      const r = compose(['ps', '-a', '--format', 'table {{.Service}}\t{{.State}}\t{{.Status}}']);
      process.stdout.write(r.stdout || r.stderr);
      return r.ok ? 0 : 1;
    }
    case 'selfcheck':
      return (await selfcheck()) ? 0 : 1;
    default:
      console.log(USAGE);
      return cmd === undefined || cmd === 'help' ? 0 : 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
