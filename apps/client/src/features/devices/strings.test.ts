import { describe, expect, it } from 'vitest';
import todo from '../../../../../docs/design/handoff/05a/urdu-todo.md?raw';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';

// 05a §8 (tasks 31, 32): every devices.* key is in ur.ts or listed in 05a/urdu-todo.md.
describe('[05a §8] devices strings', () => {
  it('every devices.* key is in ur.ts or in docs/design/handoff/05a/urdu-todo.md', () => {
    const keys = Object.keys(en).filter((k) => k.startsWith('devices.'));
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k in ur || todo.includes(`\`${k}\``), k).toBe(true);
  });
});
