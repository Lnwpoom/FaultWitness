// The `lab` CLI: `npm run lab -- <command>`. Each command group lives in its own module.
import { compose, composeLive } from './docker.ts';
import { FAULTS, FAULT_NAMES, activeFaults, applyFault, clearAll, isFaultName } from './faults.ts';
import { selfcheck } from './selfcheck.ts';

const USAGE = `usage: npm run lab -- <command>

  up             build and start the Lab (ห้องแล็บ); dashboard at http://localhost:8080/
  down           stop the Lab and remove its containers and networks
  status         show the Lab's containers and the active Faults
  faults         list the Faults with a Thai description and the expected Diagnosis
  fault <name>   create a Fault (เหตุขัดข้อง)
  clear          undo every Fault
  experiment     run the main and extended experiments and write results/
  selfcheck      verify routing, naming, certificates and faketime from a Probe-like container`;

async function main(argv: string[]): Promise<number> {
  const [cmd, arg] = argv;
  switch (cmd) {
    case 'up':
      return composeLive(['up', '-d', '--build', '--wait']) ? 0 : 1;
    case 'down':
      return composeLive(['down', '--remove-orphans', '--volumes']) ? 0 : 1;
    case 'status': {
      const r = compose(['ps', '-a', '--format', 'table {{.Service}}\t{{.State}}\t{{.Status}}']);
      process.stdout.write(r.stdout || r.stderr);
      if (!r.ok) return 1;
      const active = activeFaults();
      console.log(`\nเหตุขัดข้องที่เปิดอยู่: ${active.length ? active.map((f) => `${f} (${FAULTS[f].label})`).join(', ') : 'ไม่มี'}`);
      return 0;
    }
    case 'faults':
      for (const name of FAULT_NAMES) {
        const f = FAULTS[name];
        const expect = f.expected.length ? f.expected.join(' + ') : 'ปกติ';
        console.log(`${name.padEnd(10)} ${f.label}  →  คาดหวัง: ${expect}${f.expectObservation ? ` + ข้อสังเกตว่า ${f.expectObservation} ช้ากว่า` : ''}`);
      }
      return 0;
    case 'fault': {
      if (!arg || !isFaultName(arg)) {
        console.error(`unknown Fault ${JSON.stringify(arg ?? '')}; choose one of: ${FAULT_NAMES.join(', ')}`);
        return 2;
      }
      try {
        await applyFault(arg);
      } catch (e) {
        console.error(`fault ${arg} not applied: ${(e as Error).message}`);
        return 1;
      }
      console.log(`สร้างเหตุแล้ว: ${arg} — ${FAULTS[arg].label}`);
      return 0;
    }
    case 'clear':
      try {
        await clearAll();
      } catch (e) {
        console.error((e as Error).message);
        return 1;
      }
      console.log('คืนค่าทุกเหตุแล้ว');
      return 0;
    case 'experiment': {
      const { experiment } = await import('./experiment.ts');
      return experiment(argv.slice(1));
    }
    case 'selfcheck':
      return (await selfcheck()) ? 0 : 1;
    default:
      console.log(USAGE);
      return cmd === undefined || cmd === 'help' ? 0 : 2;
  }
}

process.exitCode = await main(process.argv.slice(2));
