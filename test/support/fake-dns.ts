// A tiny UDP DNS server on loopback, so Probe tests resolve names without the real network.
// Each name maps to an IPv4 address, or to 'silent' (the query is dropped, so the resolver times out).
// Any other name gets NXDOMAIN.
import { createSocket } from 'node:dgram';

export type FakeDnsAnswer = string | 'silent';

export interface FakeDns {
  /** `127.0.0.1:<port>`, ready for a resolver's server list */
  server: string;
  /** number of queries received per lowercased name */
  queries: Map<string, number>;
  close(): Promise<void>;
}

function readQuestion(msg: Buffer): { name: string; end: number } | null {
  let off = 12;
  const labels: string[] = [];
  while (off < msg.length) {
    const len = msg[off] ?? 0;
    if (len === 0) return { name: labels.join('.').toLowerCase(), end: off + 1 + 4 };
    labels.push(msg.subarray(off + 1, off + 1 + len).toString('latin1'));
    off += 1 + len;
  }
  return null;
}

export async function startFakeDns(names: Record<string, FakeDnsAnswer>): Promise<FakeDns> {
  const socket = createSocket('udp4');
  const queries = new Map<string, number>();

  socket.on('message', (msg, rinfo) => {
    const q = readQuestion(msg);
    if (!q || msg.length < q.end) return;
    queries.set(q.name, (queries.get(q.name) ?? 0) + 1);
    const answer = names[q.name];
    if (answer === 'silent') return;
    const qtype = msg.readUInt16BE(q.end - 4);
    const give = answer !== undefined && qtype === 1;

    const header = Buffer.alloc(12);
    msg.copy(header, 0, 0, 2); // id
    header.writeUInt16BE(answer === undefined ? 0x8183 : 0x8180, 2); // QR RD RA, rcode NXDOMAIN or NOERROR
    header.writeUInt16BE(1, 4); // QDCOUNT
    header.writeUInt16BE(give ? 1 : 0, 6); // ANCOUNT
    const parts = [header, msg.subarray(12, q.end)];
    if (give) {
      const rr = Buffer.alloc(16);
      rr.writeUInt16BE(0xc00c, 0); // pointer to the question name
      rr.writeUInt16BE(1, 2); // A
      rr.writeUInt16BE(1, 4); // IN
      rr.writeUInt32BE(0, 6); // TTL 0: nothing may be cached
      rr.writeUInt16BE(4, 10);
      answer.split('.').forEach((octet, i) => rr.writeUInt8(Number(octet), 12 + i));
      parts.push(rr);
    }
    socket.send(Buffer.concat(parts), rinfo.port, rinfo.address);
  });

  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  return {
    server: `127.0.0.1:${socket.address().port}`,
    queries,
    close: () => new Promise<void>((resolve) => socket.close(() => resolve())),
  };
}
