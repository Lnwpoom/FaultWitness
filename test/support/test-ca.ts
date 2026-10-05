// Generates, at test time, a throwaway CA plus a valid and an expired server certificate signed by it.
// Both certificates cover `*.fw.test` and 127.0.0.1. Requires the `openssl` CLI.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestCa {
  ca: string;
  key: string;
  validCert: string;
  expiredCert: string;
}

export function makeTestCa(): TestCa {
  const dir = mkdtempSync(join(tmpdir(), 'fw-test-ca-'));
  const p = (name: string) => join(dir, name);
  const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });

  writeFileSync(p('index.txt'), '');
  writeFileSync(p('serial'), '1000\n');
  writeFileSync(p('san.ext'), 'subjectAltName=DNS:*.fw.test,IP:127.0.0.1\nbasicConstraints=CA:FALSE\n');
  writeFileSync(
    p('ca.cnf'),
    [
      '[ ca ]',
      'default_ca = test_ca',
      '[ test_ca ]',
      `dir = ${dir}`,
      'database = $dir/index.txt',
      'serial = $dir/serial',
      'new_certs_dir = $dir',
      'default_md = sha256',
      'policy = any',
      'unique_subject = no',
      'copy_extensions = none',
      '[ any ]',
      'commonName = supplied',
      '',
    ].join('\n'),
  );

  openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'ca.key', '-out', 'ca.crt',
    '-days', '2', '-subj', '/CN=FaultWitness Test CA');
  openssl('req', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=fw.test');
  openssl('x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial',
    '-days', '2', '-extfile', 'san.ext', '-out', 'valid.crt');
  openssl('ca', '-batch', '-config', 'ca.cnf', '-cert', 'ca.crt', '-keyfile', 'ca.key', '-in', 'leaf.csr',
    '-startdate', '20200101000000Z', '-enddate', '20210101000000Z', '-extfile', 'san.ext', '-notext',
    '-out', 'expired.crt');

  return {
    ca: readFileSync(p('ca.crt'), 'utf8'),
    key: readFileSync(p('leaf.key'), 'utf8'),
    validCert: readFileSync(p('valid.crt'), 'utf8'),
    expiredCert: readFileSync(p('expired.crt'), 'utf8'),
  };
}
