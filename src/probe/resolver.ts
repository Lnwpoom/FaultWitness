// The Probe's one name-resolution path, shared by the DNS test and HTTP's `lookup`.
// It uses c-ares (`dns.Resolver`), not getaddrinfo, so a hanging resolver cannot starve libuv's
// thread pool, and so blocking port 53 breaks HTTP and DNS together, as the Diagnosis rules expect.
import { Resolver, getServers, type LookupAddress, type LookupOptions } from 'node:dns';
import { isIP } from 'node:net';

export type DnsFailure = 'dns_timeout' | 'dns_error';

/** A resolution failure, already classified. */
export class NameResolutionError extends Error {
  override name = 'NameResolutionError';
  readonly hostname: string;
  readonly failure: DnsFailure;
  readonly code: string;
  constructor(hostname: string, failure: DnsFailure, code: string) {
    super(`cannot resolve ${hostname}: ${code}`);
    this.hostname = hostname;
    this.failure = failure;
    this.code = code;
  }
}

export type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export interface NameResolver {
  /** IPv4 addresses for `hostname`; rejects with a NameResolutionError. */
  resolve(hostname: string): Promise<string[]>;
  /** The same resolution in the shape Node's `lookup` option expects. */
  lookup(hostname: string, options: LookupOptions, callback: LookupCallback): void;
}

export interface ResolverOptions {
  timeoutMs: number;
  /** nameservers as `ip` or `ip:port`; default: the system's (`dns.getServers()`) */
  servers?: string[];
}

/** Names answered without asking DNS: IP literals and `localhost`. */
function literal(hostname: string): string | null {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return bare;
  if (hostname.toLowerCase() === 'localhost') return '127.0.0.1';
  return null;
}

export function createNameResolver({ timeoutMs, servers }: ResolverOptions): NameResolver {
  const nameservers = servers ?? getServers();

  function resolve(hostname: string): Promise<string[]> {
    const fixed = literal(hostname);
    if (fixed) return Promise.resolve([fixed]);

    // A fresh Resolver per query, so no answer is ever cached between tests.
    const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
    resolver.setServers(nameservers);
    return new Promise<string[]>((resolvePromise, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        resolver.cancel();
        reject(new NameResolutionError(hostname, 'dns_timeout', 'ETIMEOUT'));
      }, timeoutMs);
      resolver.resolve4(hostname, (err, addresses) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          const code = err.code ?? 'EUNKNOWN';
          reject(new NameResolutionError(hostname, code === 'ETIMEOUT' ? 'dns_timeout' : 'dns_error', code));
        } else if (addresses.length === 0) {
          reject(new NameResolutionError(hostname, 'dns_error', 'ENODATA'));
        } else {
          resolvePromise(addresses);
        }
      });
    });
  }

  function lookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
    resolve(hostname).then(
      (addresses) => {
        const family = isIP(addresses[0] ?? '') || 4;
        if (options.all) callback(null, addresses.map((address) => ({ address, family: isIP(address) || 4 })));
        else callback(null, addresses[0] ?? '', family);
      },
      (err: NameResolutionError) => callback(err, options.all ? [] : ''),
    );
  }

  return { resolve, lookup };
}
