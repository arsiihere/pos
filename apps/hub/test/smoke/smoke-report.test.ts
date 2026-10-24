import { describe, expect, it } from 'vitest';
import { p95, report } from './smoke';

describe('smoke report', () => {
  it('[00 §10 #79] one line per §7.8 target, exit 1 on any miss', () => {
    const ok = report([
      { name: 'auth_pin_p95', value_ms: 120, limit_ms: 300 },
      { name: 'command_p95', value_ms: 5, limit_ms: 5 },
    ]);
    expect(ok.code).toBe(0);
    expect(ok.lines).toHaveLength(2);
    for (const line of ok.lines) expect(line).toMatch(/^\[00 §10 #79\] .* ok$/);
    const miss = report([
      { name: 'auth_pin_p95', value_ms: 120, limit_ms: 300 },
      { name: 'boot_1m', value_ms: 5_001, limit_ms: 5_000 },
    ]);
    expect(miss.code).toBe(1);
    expect(miss.lines[1]).toMatch(/^\[00 §10 #79\] boot_1m 5001\.0 ms \(limit 5000 ms\) MISS$/);
  });

  it('[00 §7.8] p95 is the nearest-rank 95th percentile', () => {
    expect(p95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(95);
    expect(p95([3, 1, 2])).toBe(3);
  });
});
