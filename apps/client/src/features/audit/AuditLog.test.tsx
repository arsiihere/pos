import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { setLanguage } from '../../i18n';
import type { Resolution } from '../staff/api';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import type { AuditApi, AuditPage } from './api';
import { AuditLog } from './AuditLog';
import { DAY, FakeIO, fakeApi, OFFSET, ROWS, shellFor, TODAY } from './test-fixtures';

// 04 §8 Audit log screen (VU2a; 04-S03): `view-audit-log`, default today on the hub clock ([from, to), whole day),
// newest first, rows as the Audit frame, infinite scroll by meta.next_cursor, loading / empty / hub-down states,
// tablet two-line rows. Response shapes: §6.5 AuditEntryView (AuditEntry of @pos/domain + names).

let m: Mounted | null = null;
beforeEach(() => {
  FakeIO.all = [];
  vi.stubGlobal('IntersectionObserver', FakeIO);
});
afterEach(() => {
  m?.unmount();
  m = null;
  setLanguage('en');
  vi.unstubAllGlobals();
});

function render(api: AuditApi, shell: Shell = shellFor(undefined, undefined, api)) {
  m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <AuditLog />
    </ShellContext.Provider>,
  );
  return m;
}

const rowTexts = (mm: Mounted) => [...mm.container.querySelectorAll('.au__body .aur')].map((r) => [...r.children].map((c) => c.textContent));

describe('[04 §8; VU2a] audit log screen', () => {
  it('[04 #60] opens on today, whole day on the hub clock: from = hub midnight, to = the next ([from, to)); no staff, no action', async () => {
    const { api, calls } = fakeApi({ first: { entries: ROWS, next_cursor: null } });
    const mm = render(api);
    await flush();
    expect(calls[0]).toEqual({ q: { from: TODAY, to: TODAY + DAY, staff_id: null, actions: [] }, cursor: null, limit: undefined });
    const bar = [...mm.container.querySelectorAll('.au__bar .flt')].map((b) => b.textContent);
    expect(bar).toEqual(['DateToday · Tue 17 Nov', 'StaffEveryone', 'ActionsAll actions']);
    expect(mm.container.querySelector('.au__bar .cap')?.textContent).toBe('Newest first · hub clock');
    expect(mm.container.querySelector('.au__bar .btn')?.textContent).toBe('Export CSV');
    expect(mm.container.querySelector('.au__bar .btn')?.getAttribute('aria-disabled')).toBeNull();
    expect([...mm.container.querySelectorAll('.aur.th span')].map((s) => s.textContent)).toEqual(['Time', 'Who', 'Action', 'Target', 'Reason', 'Outcome', 'Amount', 'Approver']);
  });

  it('[04 §8; AD-15] at 00:30 PKT (19:30Z the day before) "today" is the hub day: from = the 18th hub midnight, not the UTC date', async () => {
    const early = Date.UTC(2026, 10, 17, 19, 30); // 18 Nov 00:30 PKT
    const { api, calls } = fakeApi({ first: { entries: [], next_cursor: null } });
    const mm = render(api, shellFor(undefined, early, api));
    await flush();
    const eighteenth = Date.UTC(2026, 10, 18) - OFFSET;
    expect(calls[0]!.q).toEqual({ from: eighteenth, to: eighteenth + DAY, staff_id: null, actions: [] });
    expect(mm.container.querySelector('.au__bar .flt b')?.textContent).toBe('Today · Wed 18 Nov');
  });

  it('[04 §8] a row: time, who, action, target (table, item ×units), reason, outcome, amount, approver + method; empty cells a dash', async () => {
    const { api } = fakeApi({ first: { entries: ROWS, next_cursor: null } });
    const mm = render(api);
    await flush();
    const rows = rowTexts(mm);
    expect(rows[0]).toEqual(['9:32 PM', 'HHamza', 'Item voided', 'T12×1', 'Customer changed mind', 'To stock', 'Rs 2,400', 'Imran']);
    expect(rows[1]).toEqual(['9:32 PM', 'HHamza', 'Void answered', 'T12', '—', 'Approved', '—', 'ImranIn person']);
    expect(rows[2]).toEqual(['9:28 PM', 'HHamza', 'Void asked', 'T12Mutton Karahi — Full ×1', 'Customer changed mind', 'To stock', 'Rs 2,400', '—']);
    expect(rows[3]).toEqual(['8:58 PM', 'BBilal', 'Void answered', 'T3', '—', 'Rejected', '—', "SanaOn requester's device"]);
    // an actor with no name: "?" and the shortened id (frame Audit, O1); the screen's name for a device row
    expect(rows[4]).toEqual(['7:55 PM', '?01JDQ…G7Q2', 'Screen paired', 'Tablet 5', '—', '—', '—', '—']);
    const first = mm.container.querySelector('.au__body .aur')!;
    expect(first.querySelector('.act')?.className).toBe('act c-danger');
    expect(first.querySelector('.oc')?.className).toBe('oc c-ok');
    expect(first.querySelector('.am')?.getAttribute('dir')).toBe('ltr');
    // the last page: the end line names today
    expect(mm.container.querySelector('.au__end')?.textContent).toBe("That's everything for today");
  });

  it('[04 #60] infinite scroll: the end row in view reads the next page with meta.next_cursor, same query; rows append', async () => {
    const { api, calls } = fakeApi({ first: { entries: ROWS.slice(0, 3), next_cursor: 'C1' }, C1: { entries: ROWS.slice(3), next_cursor: null } });
    const mm = render(api);
    await flush();
    expect(mm.container.querySelector('.au__end')?.textContent).toBe('Loading more…');
    expect(mm.container.querySelector('.au__end .spin')).not.toBeNull();
    // two sightings before a render: one next page in flight (ref guard)
    FakeIO.fire();
    FakeIO.fire();
    await flush();
    expect(calls.map((c) => c.cursor)).toEqual([null, 'C1']);
    expect(calls[1]!.q).toEqual(calls[0]!.q);
    expect(rowTexts(mm).map((r) => r[0])).toEqual(['9:32 PM', '9:32 PM', '9:28 PM', '8:58 PM', '7:55 PM']);
    expect(mm.container.querySelector('.au__end')?.textContent).toBe("That's everything for today");
    // nothing more to read
    FakeIO.fire();
    await flush();
    expect(calls.length).toBe(2);
  });

  it("[04 §8; MAPPING Gaps] a failed next page keeps the rows: \"Couldn't load more · Try again\"; Try again reads the same cursor", async () => {
    const pages: Record<string, AuditPage | 'network'> = { first: { entries: ROWS.slice(0, 2), next_cursor: 'C1' }, C1: 'network' };
    const { api, calls } = fakeApi(pages);
    const mm = render(api);
    await flush();
    FakeIO.fire();
    await flush();
    expect(rowTexts(mm).length).toBe(2);
    expect(mm.container.querySelector('.au__end')?.textContent).toBe("Couldn't load more ·Try again");
    pages.C1 = { entries: ROWS.slice(2, 3), next_cursor: null };
    mm.click(mm.button('Try again'));
    await flush();
    expect(calls.map((c) => c.cursor)).toEqual([null, 'C1', 'C1']);
    expect(rowTexts(mm).length).toBe(3);
  });

  it('[04 §8; frame AuditLoading] first load: skeleton rows, filters usable, Export off', async () => {
    let release: (v: unknown) => void = () => {};
    const api: AuditApi = { auditLog: vi.fn(() => new Promise((r) => (release = r))) as never, auditStaff: vi.fn() as never };
    const mm = render(api);
    await flush();
    expect(mm.container.querySelectorAll('.au__body .aur').length).toBe(10);
    expect(mm.container.querySelectorAll('.au__body .sk').length).toBe(80);
    expect(mm.container.querySelector('.au__bar .btn')?.getAttribute('aria-disabled')).toBe('true');
    expect((mm.container.querySelector('.flt') as HTMLButtonElement).disabled).toBe(false);
    release({ ok: true, data: { entries: [], next_cursor: null } });
  });

  it('[04 §8; frame AuditEmpty] no entries: "Nothing for these filters", Export off, Clear filters', async () => {
    const { api } = fakeApi({ first: { entries: [], next_cursor: null } });
    const mm = render(api);
    await flush();
    expect(mm.text()).toContain('Nothing for these filters');
    expect(mm.text()).toContain('No entries on Tue 17 Nov. Try another day.');
    expect(mm.container.querySelector('.empty .ring.c-mute')).not.toBeNull();
    expect(mm.container.querySelector('.au__bar .btn')?.getAttribute('aria-disabled')).toBe('true');
    expect(mm.button('Clear filters')).toBeTruthy();
  });

  it('[04 §8; frame AuditError] hub down: calm message, filters kept, Try again reads again; Export off', async () => {
    const pages: Record<string, AuditPage | 'network' | 'refused'> = { first: 'network' };
    const { api, calls } = fakeApi(pages);
    const mm = render(api);
    await flush();
    expect(mm.text()).toContain("The hub can't be reached");
    expect(mm.text()).toContain('Check the Wi-Fi. Your filters are kept.');
    expect(mm.container.querySelector('.empty .ring.c-danger')).not.toBeNull();
    expect(mm.container.querySelector('.au__bar .btn')?.getAttribute('aria-disabled')).toBe('true');
    expect(mm.container.querySelectorAll('.au__bar .flt').length).toBe(3);
    pages.first = { entries: ROWS.slice(0, 1), next_cursor: null };
    mm.click(mm.button('Try again'));
    await flush();
    expect(calls.length).toBe(2);
    expect(rowTexts(mm).length).toBe(1);
    // a refused query (400) says so, not "can't be reached"
    m?.unmount();
    m = null;
    const refused = render(fakeApi({ first: 'refused' }).api);
    await flush();
    expect(refused.text()).toContain('The hub refused this search');
    expect(refused.text()).not.toContain("can't be reached");
  });

  it('[04 §8; R5] without view-audit-log (or with requires_approval) the screen draws nothing and reads nothing', async () => {
    for (const perms of [{}, { 'view-audit-log': { grant: 'requires_approval', approver_role_ids: [], scope: 'branch' } } as Record<string, Resolution>]) {
      const { api } = fakeApi({ first: { entries: ROWS, next_cursor: null } });
      const mm = render(api, shellFor(perms, undefined, api));
      await flush();
      expect(mm.container.innerHTML).toBe('');
      mm.unmount();
      m = null;
    }
  });

  it('[04 §8; frame AuditTablet] tablet: two-line rows (time · what · who + approver line · outcome and amount)', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 1359px)', addEventListener() {}, removeEventListener() {} }));
    const { api } = fakeApi({ first: { entries: ROWS.slice(0, 4), next_cursor: null } });
    const mm = render(api);
    await flush();
    expect([...mm.container.querySelectorAll('.aur.th span')].map((s) => s.textContent)).toEqual(['Time', 'What', 'Who', 'Outcome · amount']);
    const rows = [...mm.container.querySelectorAll('.au__body .aur--t')];
    expect(rows.length).toBe(4);
    expect([...rows[0]!.children].map((c) => c.textContent)).toEqual(['9:32 PM', 'Item voidedT12 ×1“Customer changed mind”', 'HHamzaApprover Imran', 'To stockRs 2,400']);
    expect(rows[1]!.querySelector('.sub2')?.textContent).toBe('Approver Imran · in person');
    expect(rows[3]!.querySelector('.sub2')?.textContent).toBe("Approver Sana · on requester's device");
    // one day: no day headers
    expect(mm.container.querySelector('.au__day')).toBeNull();
  });

  it('[04 §8 R20; frame AuditUrdu] Urdu: words from ur, times and amounts stay Latin and LTR', async () => {
    setLanguage('ur');
    const { api } = fakeApi({ first: { entries: ROWS.slice(0, 1), next_cursor: null } });
    const mm = render(api);
    await flush();
    const row = rowTexts(mm)[0]!;
    expect(row[0]).toBe('9:32 PM');
    expect(row[2]).toBe('آئٹم ووئڈ');
    expect(row[4]).toBe('گاہک نے ارادہ بدل لیا');
    expect(row[5]).toBe('اسٹاک میں');
    expect(row[6]).toBe('Rs 2,400');
    expect(mm.container.querySelector('.au__bar .flt b')?.textContent).toBe('آج · 17 نومبر');
    expect(mm.container.querySelector('.au__end')?.textContent).toBe('آج کے سب اندراج');
  });
});
