// `lab selfcheck`: proves the Lab network behaves as the spec says, using the toolbox container
// placed like a Probe. Each check leaves the Lab as it found it.
import { exec, execAsync, sleep } from './docker.ts';

interface Check {
  name: string;
  run: () => Promise<string | null>; // null = pass, string = why it failed
}

const tool = (cmd: string) => exec('toolbox', ['sh', '-c', cmd]);
const https = (host: string) => tool(`curl -sS --max-time 3 --cacert /lab/certs/ca.crt https://${host}/`);
const expectOk = (r: { ok: boolean; stderr: string }, what: string) => (r.ok ? null : `${what}: ${r.stderr.trim()}`);

const BLOCK_OUTER = ['iptables', '-I', 'FORWARD', '-d', '10.77.2.0/24', '-j', 'DROP'];
const UNBLOCK_OUTER = ['iptables', '-D', 'FORWARD', '-d', '10.77.2.0/24', '-j', 'DROP'];

const checks: Check[] = [
  { name: 'HTTPS to Site X by name with the Lab CA', run: async () => expectOk(https('site-x.lab'), 'site-x') },
  { name: 'HTTPS to Site Y by name with the Lab CA', run: async () => expectOk(https('site-y.lab'), 'site-y') },
  {
    name: 'HTTP to the Internal Service by name',
    run: async () => expectOk(tool('curl -sS --max-time 3 http://intranet.lab:8081/'), 'intranet'),
  },
  {
    name: 'TCP to both sites\' fixed IPs on 443',
    run: async () => expectOk(tool('nc -z -w3 10.77.2.10 443 && nc -z -w3 10.77.2.11 443'), 'tcp'),
  },
  {
    name: 'outer traffic goes through the gateway (blocking forwarding there breaks it)',
    run: async () => {
      const add = exec('gateway', BLOCK_OUTER);
      if (!add.ok) return `could not add gateway rule: ${add.stderr}`;
      const blocked = https('site-y.lab');
      exec('gateway', UNBLOCK_OUTER);
      if (blocked.ok) return 'site-y still reachable with forwarding blocked at the gateway';
      return expectOk(https('site-y.lab'), 'site-y after removing the rule');
    },
  },
  {
    name: 'expired certificate on Site X fails validation; switching back restores it',
    run: async () => {
      const swap = exec('site-x', ['use-cert', 'expired']);
      if (!swap.ok) return `use-cert expired: ${swap.stderr}`;
      const bad = https('site-x.lab');
      exec('site-x', ['use-cert', 'valid']);
      if (bad.ok || !/certificate/i.test(bad.stderr)) return `expected a certificate error, got: ${bad.stderr || 'success'}`;
      return expectOk(https('site-x.lab'), 'site-x after switching back');
    },
  },
  {
    name: 'faketime flips a running Node process to 2019 and back without a restart',
    run: async () => {
      // One long-running Node process under libfaketime; the clock file is written from outside it.
      const script = `
        const https = require('node:https');
        const probe = () => new Promise((res) => https.get('https://site-x.lab/', { agent: false, timeout: 3000 },
          (r) => { r.resume(); res('ok'); }).on('error', (e) => res(e.code)));
        (async () => { for (let i = 0; i < 6; i++) {
          console.log(new Date().getUTCFullYear() + ' ' + await probe());
          await new Promise((r) => setTimeout(r, 1000)); } })();`;
      exec('toolbox', ['sh', '-c', "mkdir -p /run/faketime && echo '+0' > /run/faketime/rc"]);
      const run = execAsync('toolbox', ['/lab/bin/faketime-node', '-e', script]);
      await sleep(1500);
      exec('toolbox', ['sh', '-c', "echo '@2019-01-01 00:00:00' > /run/faketime/rc"]);
      await sleep(2500);
      exec('toolbox', ['sh', '-c', "echo '+0' > /run/faketime/rc"]);
      const out = (await run).stdout.trim().split('\n');
      const year = new Date().getUTCFullYear();
      const saw2019 = out.some((l) => l === '2019 CERT_NOT_YET_VALID');
      const before = out[0] === `${year} ok`;
      const after = out.at(-1) === `${year} ok`;
      return saw2019 && before && after ? null : `unexpected sequence: ${out.join(' | ')}`;
    },
  },
];

export async function selfcheck(): Promise<boolean> {
  let pass = true;
  for (const c of checks) {
    const why = await c.run();
    console.log(`${why === null ? 'PASS' : 'FAIL'}  ${c.name}${why === null ? '' : `\n      ${why}`}`);
    if (why !== null) pass = false;
  }
  return pass;
}
