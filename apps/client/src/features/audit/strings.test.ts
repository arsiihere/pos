import { AUDIT_ACTIONS } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import todo from '../../../../../docs/design/handoff/04/urdu-todo.md?raw';
import kit from '../../app/ui-kit-staff.ts?raw';
import { ACTION_META, AUDIT_GROUPS, OUTCOMES } from './labels';

// 04 §8 Rules (VU2; D12 i18n keys only, R20; integrator O5): every audit key is in en, and in ur or the 04 Urdu to-do
// list; every AUDIT_ACTIONS value has a label and a group; the staff kit loads the audit stylesheet.

const todoKeys = new Set([...todo.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]));
const keys = Object.keys(en).filter((k) => k.startsWith('audit.'));

describe('[04 §8 Rules] audit strings', () => {
  it('[04 O5] every AUDIT_ACTIONS value has an en label and one of the groups; every outcome has a label', () => {
    expect(Object.keys(ACTION_META).sort()).toEqual([...AUDIT_ACTIONS].sort());
    for (const a of AUDIT_ACTIONS) {
      expect(en, a).toHaveProperty(`audit.action.${a}`);
      expect(AUDIT_GROUPS).toContain(ACTION_META[a].group);
    }
    for (const o of OUTCOMES) expect(en, o).toHaveProperty(`audit.out.${o}`);
  });

  it('[04 §8 R20] every audit.* key is in ur or in docs/design/handoff/04/urdu-todo.md (not both); ur keeps the placeholders', () => {
    const urKeys = ur as Record<string, string | undefined>;
    const enKeys = en as Record<string, string>;
    for (const k of keys) {
      const inUr = urKeys[k] !== undefined;
      expect(inUr || todoKeys.has(k), `${k}: no Urdu and not in urdu-todo.md`).toBe(true);
      expect(inUr && todoKeys.has(k), `${k}: in ur.ts and in urdu-todo.md`).toBe(false);
      if (inUr) {
        const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        const need = holes(enKeys[k]!).filter((h) => !(k === 'audit.date' && h === 'weekday'));
        expect(holes(urKeys[k]!), k).toEqual(need);
      }
    }
    for (const k of todoKeys) if (k.startsWith('audit.')) expect(en, k).toHaveProperty(k);
  });

  it('[04 O2] straight apostrophes only', () => {
    for (const k of keys) expect((en as Record<string, string>)[k], k).not.toMatch(/[‘’]/);
  });
});

describe('[04 handoff PROMPT step 1] pulse-04-audit.css', () => {
  // (vitest hands CSS to tests empty, so the rules themselves are checked in the browser: VU2 PR screenshots)
  it('the staff kit imports the VU2 additions last (after pulse-04.css once VU1 lands)', () => {
    const imports = [...kit.matchAll(/^import\s+['"]([^'"]+)['"];/gm)].map((m) => m[1]);
    const at = imports.indexOf('../../../../packages/ui-kit/components/pulse-04-audit.css');
    expect(at).toBeGreaterThan(imports.indexOf('../../../../packages/ui-kit/components/pulse-02.css'));
    expect(at).toBe(imports.length - 1);
  });
});
