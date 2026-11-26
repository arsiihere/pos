import { AUDIT_ACTIONS } from '@pos/domain';
import { describe, expect, it } from 'vitest';
import { en } from '../../i18n/en';
import { ur } from '../../i18n/ur';
import todo from '../../../../../docs/design/handoff/04/urdu-todo.md?raw';
import kit from '../../app/ui-kit-staff.ts?raw';
import { ACTION_META, AUDIT_GROUPS, OUTCOMES } from './labels';

const todoText: string = todo;

// 04 §8 Rules (VU2; D12 i18n keys only, R20; integrator O5): every audit key is in en, and in ur or the 04 Urdu to-do
// list; every AUDIT_ACTIONS value has a label and a group; the staff kit loads the audit stylesheet.

const todoKeys = new Set([...todo.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]));
const keys = Object.keys(en).filter((k) => k.startsWith('audit.'));

describe('[04 §8 Rules] audit strings', () => {
  it('[04 O5] every AUDIT_ACTIONS value has an en label and one of the groups; every group and outcome has a label', () => {
    expect(Object.keys(ACTION_META).sort()).toEqual([...AUDIT_ACTIONS].sort());
    for (const a of AUDIT_ACTIONS) {
      expect(en, a).toHaveProperty(`audit.action.${a}`);
      expect(AUDIT_GROUPS).toContain(ACTION_META[a].group);
    }
    for (const g of AUDIT_GROUPS) expect(en, g).toHaveProperty(`audit.actions.group.${g}`);
    for (const o of OUTCOMES) expect(en, o).toHaveProperty(`audit.out.${o}`);
  });

  it('[05 P0.15, R-28] the new actions sit in the two 05 groups, walk_out has a reason label, and every new key is in the 05 section of urdu-todo.md', () => {
    const bills = ['fiscal_token_changed', 'bill_opened', 'check_bill_printed', 'bill_requested', 'splits_set', 'discount_requested', 'discount_answered', 'discount_applied', 'discount_removed', 'service_charge_applied', 'service_charge_removed', 'payment_added', 'payment_removed', 'buyer_id_waived', 'invoice_issued', 'bill_reopened', 'invoice_credited', 'fiscal_rejected', 'comp_removed', 'bill_closed_empty', 'money_request_raised', 'money_request_answered'] as const;
    const shifts = ['shift_opened', 'shift_counted', 'shift_count_skipped', 'handover_counted', 'shift_closed', 'shift_variance_signed_off', 'petty_cash', 'drawer_opened', 'orders_carried_over', 'z_report_issued'] as const;
    for (const a of bills) expect(ACTION_META[a].group, a).toBe('bills_payments');
    for (const a of shifts) expect(ACTION_META[a].group, a).toBe('shifts_cash');
    expect(en['audit.actions.group.bills_payments']).toBe('Bills and payments');
    expect(en['audit.actions.group.shifts_cash']).toBe('Shifts and cash');
    expect(en['audit.action.bill_requested']).toBe('Bill asked for');
    expect(en['audit.action.z_report_issued']).toBe('Z report issued');
    expect(en['audit.reason.walk_out']).toBe('Walked out without paying');
    expect(en['void.reason.walk_out']).toBe('Walked out without paying');
    // void.reason.walk_out is a VU1 key: apps/client/test/voids-i18n.test.ts requires it in the VU1 section.
    expect(todoText.split(/^## /m).find((x) => x.startsWith('VU1')) ?? '').toContain('| `void.reason.walk_out` |');
    const section = todoText.split(/^## /m).find((x) => x.startsWith('05 P0.15')) ?? '';
    for (const k of [...bills, ...shifts].map((a) => `audit.action.${a}`).concat(['audit.actions.group.bills_payments', 'audit.actions.group.shifts_cash', 'audit.reason.walk_out'])) {
      expect(section, k).toContain(`| \`${k}\` |`);
    }
  });

  it('[04 v1.0.9 §3.6] the takeaway pilot actions sit in Bills and payments, have en labels and are in the 02b-TK section of urdu-todo.md', () => {
    const tk = ['cart_check_bill_printed', 'unpaid_handover_requested', 'unpaid_handover_answered', 'unpaid_handover_approved'] as const;
    for (const a of tk) expect(ACTION_META[a].group, a).toBe('bills_payments');
    expect(en['audit.action.cart_check_bill_printed']).toBe('Cart check bill printed');
    expect(en['audit.action.unpaid_handover_requested']).toBe('Unpaid hand-over asked');
    expect(en['audit.action.unpaid_handover_answered']).toBe('Unpaid hand-over answered');
    expect(en['audit.action.unpaid_handover_approved']).toBe('Unpaid hand-over approved');
    const section = todoText.split(/^## /m).find((x) => x.startsWith('02b-TK')) ?? '';
    for (const a of tk) expect(section, a).toContain(`| \`audit.action.${a}\` |`);
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
  // merge 04-client → main: main's Q-73 staff-02-additions.css (only .tabbar--5, no 04 selector) is the kit's last
  // import, pinned by test/pulse-02.test.ts; the VU2 additions are the last of the 04 layers
  it('the staff kit imports the VU2 additions last of the 04 layers (after pulse-04.css and pulse-04-additions.css)', () => {
    const imports = [...kit.matchAll(/^import\s+['"]([^'"]+)['"];/gm)].map((m) => m[1]);
    const at = imports.indexOf('../../../../packages/ui-kit/components/pulse-04-audit.css');
    expect(at).toBeGreaterThan(imports.indexOf('../../../../packages/ui-kit/components/pulse-02.css'));
    expect(at).toBeGreaterThan(imports.indexOf('../../../../packages/ui-kit/components/pulse-04.css'));
    expect(at).toBe(imports.indexOf('../../../../packages/ui-kit/components/pulse-04-additions.css') + 1);
    expect(imports.slice(at + 1)).toEqual(['../../../../packages/ui-kit/components/staff-02-additions.css']);
  });
});
