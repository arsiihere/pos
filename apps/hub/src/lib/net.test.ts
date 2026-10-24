import { describe, expect, it } from 'vitest';
import { createHostMatcher, createNetMatcher } from './net';

describe('net', () => {
  it('[00 §3.9] guest CIDR matches IPv4 and IPv4-mapped IPv6 (Review Focus 1)', () => {
    const guest = createNetMatcher(['192.168.20.0/24']);
    expect(guest('192.168.20.7')).toBe(true);
    expect(guest('::ffff:192.168.20.7')).toBe(true);
    expect(guest('192.168.10.7')).toBe(false);
  });

  it('[00 §3.1 M45] host matcher: allowed, wrong port, other host, missing header, setup-mode own address', () => {
    const match = createHostMatcher({
      port: 3000,
      advertisedHost: '192.168.10.2',
      ownIPv4: ['10.0.0.5'],
    });
    expect(match('192.168.10.2:3000')).toBe(true);
    expect(match('localhost:3000')).toBe(true);
    expect(match('127.0.0.1:3000')).toBe(true);
    expect(match('192.168.10.2:3001')).toBe(false);
    expect(match('evil.example:3000')).toBe(false);
    expect(match('10.0.0.5:3000')).toBe(false);
    expect(match(undefined)).toBe(false);

    const setup = createHostMatcher({ port: 3000, advertisedHost: null, ownIPv4: ['10.0.0.5'] });
    expect(setup('10.0.0.5:3000')).toBe(true);
    expect(setup('192.168.10.9:3000')).toBe(false);
  });

  it('[00 §3.1 M45] host matcher normalises case and a trailing dot (Review Focus 2)', () => {
    const match = createHostMatcher({
      port: 3000,
      advertisedHost: '192.168.10.2',
      ownIPv4: [],
    });
    expect(match('LOCALHOST:3000')).toBe(true);
    expect(match('localhost.:3000')).toBe(true);
    expect(match('LocalHost.:3000')).toBe(true);
  });
});
