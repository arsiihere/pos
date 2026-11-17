// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { ur } from '../src/i18n/ur';

// 04 §8 "i18n keys only (D12), Latin digits (R20)"; handoff 04 Rules: every VU1 key is in en, and in ur or in
// docs/design/handoff/04/urdu-todo.md (never both); an Urdu text keeps the English placeholders. Spec copy (§8, §9)
// is pinned word for word (integrator rulings C1–C11, O1, O2: straight apostrophe).

const root = fileURLToPath(new URL('../../../', import.meta.url));
const todo = readFileSync(root + 'docs/design/handoff/04/urdu-todo.md', 'utf8');
const start = todo.indexOf('## VU1');
const next = todo.indexOf('\n## ', start + 5);
const section = todo.slice(start, next < 0 ? undefined : next);
const PREFIXES = ['void.', 'void_all.', 'answer.void.', 'alert.void_approval.', 'admin_stock.errors.DAY_CLOSE_BLOCKED', 'line.void'];
const holes = (text: string) => [...text.matchAll(/\{\w+\}/g)].map((m) => m[0]).sort().join();
const E = en as Record<string, string>;
const U = ur as Record<string, string | undefined>;

describe('04 VU1 client strings', () => {
  it('[04 §8 Rules] every VU1 key is in ur or 04/urdu-todo.md (not both); Urdu keeps the placeholders and Latin digits', () => {
    const keys = Object.keys(en).filter((k) => PREFIXES.some((p) => k.startsWith(p)));
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) {
      const listed = section.includes(`| \`${key}\` |`);
      const urText = U[key];
      expect(urText !== undefined || listed, key).toBe(true);
      if (urText !== undefined) {
        expect(listed, key).toBe(false);
        expect(holes(urText), key).toBe(holes(E[key]!));
        expect(urText, key).not.toMatch(/[٠-٩۰-۹]/);
      }
    }
  });

  it('[04 §8, §9] the spec copy, straight apostrophes (O2)', () => {
    expect(E['void.block.stock_not_tracked']).toBe('Stock not tracked for this item');
    expect(E['void.block.not_movable_stage']).toBe('Not cooking or cooked');
    expect(E['void.block.move_not_granted']).toBe("You can't move to stock");
    expect(E['void.block.day_closed']).toBe('Business day closed');
    expect(E['void.disposition.moved_partly']).toBe('Cooked parts to stock, the rest released');
    expect(E['void.err.VOID_PENDING']).toBe('A void is already waiting on this item');
    expect(E['void.err.COMP_PENDING']).toBe('A comp is waiting on this item — decide it first');
    expect(E['void.err.ITEM_WRONG_STAGE']).toBe('Not started — use Remove');
    expect(E['void.err.ORDER_BILLED']).toBe('Bill closed — refunds are at the counter');
    expect(E['void.do']).toBe('Void');
    expect(E['comp.ask']).toBe('Ask for approval');
    for (const key of Object.keys(en).filter((k) => PREFIXES.some((p) => k.startsWith(p)))) expect(E[key], key).not.toContain('’');
  });
});
