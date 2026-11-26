import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { setLanguage } from '../../i18n';
import { ShellContext } from '../staff/shell/hooks';
import type { AuditApi } from './api';
import { AuditLog } from './AuditLog';
import { at, DAY, entry, FakeIO, fakeApi, ROWS, shellFor, TODAY } from './test-fixtures';

// 04 §8 filters (VU2b; 04-C04–C06): Date presets + calendar (whole hub days, [from, to), ≤ 31 days, future off),
// Staff from audit-staff (Everyone first, "left", actor or approver), Actions grouped (⊆ AUDIT_ACTIONS). A changed
// filter reads the first page again with the new query.

const STAFF = [
  { staff_id: 'S-ALI', display_name: 'Ali', in_directory: true },
  { staff_id: 'S-BILAL', display_name: 'Bilal', in_directory: true },
  { staff_id: 'S-DANISH', display_name: 'Danish', in_directory: false },
  { staff_id: 'S-HAMZA', display_name: 'Hamza', in_directory: true },
];

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

function render(api: AuditApi) {
  m = mount();
  m.render(
    <ShellContext.Provider value={shellFor(undefined, undefined, api)}>
      <AuditLog />
    </ShellContext.Provider>,
  );
  return m;
}

const flt = (mm: Mounted, i: number) => mm.container.querySelectorAll<HTMLButtonElement>('.au__bar .flt')[i]!;
const pop = (mm: Mounted) => mm.container.querySelector<HTMLElement>('.pop');

describe('[04 §8; VU2b] audit filters', () => {
  it('[04 #60] Date: a preset, then Show n days → from = hub midnight 6 days back, to = after today; the filter shows it', async () => {
    const { api, calls } = fakeApi({ first: { entries: ROWS, next_cursor: null } });
    const mm = render(api);
    await flush();
    mm.click(flt(mm, 0));
    expect(flt(mm, 0).classList.contains('is-open')).toBe(true);
    expect([...pop(mm)!.querySelectorAll('.chip')].map((c) => [c.textContent, c.getAttribute('aria-pressed')])).toEqual([
      ['Today', 'true'],
      ['Yesterday', 'false'],
      ['Last 7 days', 'false'],
      ['This month', 'false'],
    ]);
    expect(pop(mm)!.querySelector('.calh span')?.textContent).toBe('November 2026');
    mm.click(mm.button('Last 7 days', pop(mm)!));
    expect([...pop(mm)!.querySelectorAll('.dr .inp')].map((s) => s.textContent)).toEqual(['11 Nov 2026', '17 Nov 2026']);
    expect(pop(mm)!.querySelector('.hint')?.textContent).toBe("Up to 31 days. Days later than that can't be picked.");
    mm.click(mm.button('Show 7 days'));
    await flush();
    expect(pop(mm)).toBeNull();
    expect(calls.at(-1)!.q).toEqual({ from: TODAY - 6 * DAY, to: TODAY + DAY, staff_id: null, actions: [] });
    expect(flt(mm, 0).textContent).toBe('DateLast 7 days');
    expect(flt(mm, 0).classList.contains('is-set')).toBe(true);
    // the end line no longer says "for today"
    expect(mm.container.querySelector('.au__end')?.textContent).toBe("That's everything");
  });

  it('[04 #60; AD-15] Date calendar: two taps make a whole-day range; future days and days past 31 are off; Cancel keeps the old range', async () => {
    const { api, calls } = fakeApi({ first: { entries: ROWS, next_cursor: null } });
    const mm = render(api);
    await flush();
    mm.click(flt(mm, 0));
    const day = (label: string) => pop(mm)!.querySelector<HTMLButtonElement>(`.cal button[aria-label="${label}"]`)!;
    expect(day('18 Nov 2026').getAttribute('aria-disabled')).toBe('true');
    expect(day('18 Nov 2026').className).toBe('fut');
    mm.click(day('18 Nov 2026'));
    mm.click(day('3 Nov 2026'));
    mm.click(day('5 Nov 2026'));
    expect(mm.button('Show 3 days')).toBeTruthy();
    expect(day('4 Nov 2026').className).toBe('in');
    // Cancel: nothing read
    const before = calls.length;
    mm.click(mm.button('Cancel'));
    expect(pop(mm)).toBeNull();
    await flush();
    expect(calls.length).toBe(before);
    // 31 days at most: from 17 Nov the previous month's days before 18 Oct are off
    mm.click(flt(mm, 0));
    mm.click(day('17 Nov 2026'));
    mm.click(mm.button('Previous month', pop(mm)!));
    expect(pop(mm)!.querySelector('.calh span')?.textContent).toBe('October 2026');
    expect(day('17 Oct 2026').getAttribute('aria-disabled')).toBe('true');
    expect(day('18 Oct 2026').getAttribute('aria-disabled')).toBeNull();
    mm.click(day('18 Oct 2026'));
    mm.click(mm.button('Show 31 days'));
    await flush();
    const q = calls.at(-1)!.q;
    expect([q.from, q.to]).toEqual([Date.UTC(2026, 9, 18) - 5 * 3_600_000, TODAY + DAY]);
    expect(q.to - q.from).toBe(31 * DAY);
    expect(flt(mm, 0).textContent).toBe('Date18 Oct – 17 Nov');
  });

  it('[04 #60b] Staff from audit-staff: Everyone first, a leaver marked "left" and pickable; the query matches actor or approver; no role', async () => {
    const { api, calls, staffCalls } = fakeApi({ first: { entries: ROWS, next_cursor: null } }, STAFF);
    const mm = render(api);
    await flush();
    expect(staffCalls.length).toBe(0);
    mm.click(flt(mm, 1));
    await flush();
    expect(staffCalls.length).toBe(1);
    const rows = [...pop(mm)!.querySelectorAll('.pop__r')];
    expect(rows.map((r) => r.textContent)).toEqual(['Everyone', 'AAli', 'BBilal', 'DDanishleft', 'HHamza']);
    expect(rows[0]!.getAttribute('aria-checked')).toBe('true');
    expect(pop(mm)!.querySelector('.pop__s input')?.getAttribute('placeholder')).toBe('Find a name');
    expect(pop(mm)!.textContent).toContain('Matches what they did and what they approved. "left" = no longer on the staff list.');
    // search
    const input = pop(mm)!.querySelector<HTMLInputElement>('.pop__s input')!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, 'dan');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(1);
    expect([...pop(mm)!.querySelectorAll('.pop__r')].map((r) => r.textContent)).toEqual(['DDanishleft']);
    mm.click(pop(mm)!.querySelector('.pop__r'));
    await flush();
    expect(pop(mm)).toBeNull();
    expect(calls.at(-1)!.q.staff_id).toBe('S-DANISH');
    expect(flt(mm, 1).textContent).toBe('StaffDanish');
    expect(flt(mm, 1).classList.contains('is-set')).toBe(true);
  });

  it('[04 #60; O5] Actions: grouped ticks, group All, Show 4 actions → action list; "Voids" with a count; Clear → all actions', async () => {
    const { api, calls } = fakeApi({ first: { entries: [], next_cursor: null } }, STAFF);
    const mm = render(api);
    await flush();
    mm.click(flt(mm, 2));
    const groups = [...pop(mm)!.querySelectorAll('.pop__g')].map((g) => g.firstChild?.textContent);
    expect(groups).toEqual(['Voids and comps', 'Requests', 'Orders and tables', 'Day and stock', 'Kitchen and menu', 'Screens and PINs', 'Bills and payments', 'Shifts and cash']);
    expect(pop(mm)!.querySelectorAll('.pop__r[role="checkbox"]').length).toBe(71); // 05a row A-1: + device_profile_set; 04 v1.0.9: + the 4 takeaway pilot actions
    const box = (label: string) => [...pop(mm)!.querySelectorAll<HTMLElement>('.pop__r')].find((r) => r.textContent === label)!;
    for (const a of ['Void asked', 'Void answered', 'Item voided', 'Moved to ready stock']) mm.click(box(a));
    expect(box('Void asked').getAttribute('aria-checked')).toBe('true');
    expect(box('Void asked').querySelector('.chk--on')).not.toBeNull();
    mm.click(mm.button('Show 4 actions'));
    await flush();
    expect(calls.at(-1)!.q.actions).toEqual(['void_requested', 'void_answered', 'item_voided', 'item_moved_to_stock']);
    expect(flt(mm, 2).textContent).toBe('ActionsVoids4');
    // empty with a person and the preset: the frame's sentence
    mm.click(flt(mm, 1));
    await flush();
    mm.click([...pop(mm)!.querySelectorAll<HTMLElement>('.pop__r')].find((r) => r.textContent === 'BBilal'));
    await flush();
    expect(mm.text()).toContain('No voids by Bilal on Tue 17 Nov. Try another day or Everyone.');
    // group All, then Clear
    mm.click(flt(mm, 2));
    const all = [...pop(mm)!.querySelectorAll<HTMLElement>('.pop__g button')][1]!;
    mm.click(all);
    expect(mm.button('Show 8 actions')).toBeTruthy();
    mm.click(mm.button('Clear', pop(mm)!));
    mm.click(mm.button('Show all actions'));
    await flush();
    expect(calls.at(-1)!.q.actions).toEqual([]);
    expect(flt(mm, 2).textContent).toBe('ActionsAll actions');
    // Clear filters (empty state): back to today, Everyone, all actions
    mm.click(mm.button('Clear filters'));
    await flush();
    expect(calls.at(-1)!.q).toEqual({ from: TODAY, to: TODAY + DAY, staff_id: null, actions: [] });
  });

  it('[04 §8 a11y] Escape closes a popover and gives the focus back to its filter; one popover at a time', async () => {
    const { api } = fakeApi({ first: { entries: ROWS, next_cursor: null } }, STAFF);
    const mm = render(api);
    await flush();
    mm.click(flt(mm, 2));
    expect(mm.container.querySelectorAll('.pop').length).toBe(1);
    mm.click(flt(mm, 0));
    expect(mm.container.querySelectorAll('.pop').length).toBe(1);
    expect(pop(mm)!.getAttribute('aria-label')).toBe('Date');
    mm.key(pop(mm), 'Escape');
    expect(pop(mm)).toBeNull();
    expect(document.activeElement).toBe(flt(mm, 0));
    expect(flt(mm, 0).getAttribute('aria-expanded')).toBe('false');
  });

  it('[04 §8; frame AuditTablet] a range of several days on a tablet: day headers with the row count, "Today · Tue 17 Nov"', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(max-width: 1359px)', addEventListener() {}, removeEventListener() {} }));
    const rows = [...ROWS.slice(0, 4), entry({ seq: 3, recorded_at: at(22, 12) - DAY }), entry({ seq: 2, recorded_at: at(22, 9) - DAY, action: 'void_requested' })];
    const { api } = fakeApi({ first: { entries: rows, next_cursor: null } });
    const mm = render(api);
    await flush();
    expect(mm.container.querySelector('.au__day')).toBeNull();
    mm.click(flt(mm, 0));
    mm.click(mm.button('Last 7 days', pop(mm)!));
    mm.click(mm.button('Show 7 days'));
    await flush();
    expect([...mm.container.querySelectorAll('.au__day')].map((d) => d.textContent)).toEqual(['Today · Tue 17 Nov4', 'Mon 16 Nov2']);
  });
});
