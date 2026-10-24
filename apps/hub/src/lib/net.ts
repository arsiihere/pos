/// <reference types="node" />
import { BlockList } from 'node:net';
import os from 'node:os';

export function createNetMatcher(cidrs: string[]): (ip: string) => boolean {
  const list = new BlockList();
  for (const cidr of cidrs) {
    const slash = cidr.lastIndexOf('/');
    list.addSubnet(cidr.slice(0, slash), Number(cidr.slice(slash + 1)), 'ipv4');
  }
  return (ip) => {
    const v4 = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
    try {
      return list.check(v4, 'ipv4');
    } catch {
      return false;
    }
  };
}

export function listOwnIPv4(ifaces: ReturnType<typeof os.networkInterfaces> = os.networkInterfaces()): string[] {
  const addresses: string[] = [];
  for (const entries of Object.values(ifaces)) {
    for (const entry of entries ?? []) {
      if (!entry.internal && entry.family === 'IPv4') addresses.push(entry.address);
    }
  }
  return addresses;
}

export function createHostMatcher(o: {
  port: number;
  advertisedHost: string | null;
  ownIPv4: string[];
}): (hostHeader: string | undefined) => boolean {
  const allowed = new Set<string>([`localhost:${o.port}`, `127.0.0.1:${o.port}`]);
  if (o.advertisedHost !== null) allowed.add(`${o.advertisedHost.toLowerCase()}:${o.port}`);
  else for (const ip of o.ownIPv4) allowed.add(`${ip.toLowerCase()}:${o.port}`);
  return (hostHeader) => {
    if (hostHeader === undefined || hostHeader.length === 0) return false;
    const normalised = normaliseHost(hostHeader);
    return normalised !== null && allowed.has(normalised);
  };
}

function normaliseHost(header: string): string | null {
  const colon = header.lastIndexOf(':');
  if (colon <= 0) return null;
  let host = header.slice(0, colon).toLowerCase();
  const port = header.slice(colon + 1);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return `${host}:${port}`;
}
