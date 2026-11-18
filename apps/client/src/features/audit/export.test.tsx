import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../test/dom';
import { setLanguage } from '../../i18n';
import { ShellContext, type Shell } from '../staff/shell/hooks';
import { createToastBus } from '../staff/shell/toast';
import type { AuditApi, AuditPage } from './api';
import { AuditLog } from './AuditLog';
import { csvOf, exportFileName } from './export';
import { DAY, entry, FakeIO, fakeApi, OFFSET, ROWS, shellFor, TODAY } from './test-fixtures';

// 04 §8 / V17 Export CSV (VU2c; 04-D09, frame AuditExport): pages the same audit-log query (same filters, ≤ 31 days)
// by meta.next_cursor and builds the file in the browser; progress + Stop; file audit-<branch>-<from>-to-<to>.csv.

let m: Mounted | null = null;
let saved: Array<{ name: string; text: string }> = [];
beforeEach(() => {
  FakeIO.all = [];
  saved = [];
  vi.stubGlobal('IntersectionObserver', FakeIO);
});
afterEach(() => {
  m?.unmount();
  m = null;
  setLanguage('en');
  vi.unstubAllGlobals();
});

function render(pages: Record<string, AuditPage | 'network'>, staff: Array<{ staff_id: string; display_name: string; in_directory: boolean }> = []) {
  const fake = fakeApi(pages, staff);
  const shell = { ...shellFor(undefined, undefined, fake.api), toasts: createToastBus() } as Shell;
  m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <AuditLog save={(name, text) => saved.push({ name, text })} />
    </ShellContext.Provider>,
  );
  return { mm: m, ...fake, shell };
}

describe('[04 §8; V17] CSV', () => {
  it('one header row and one line per entry, in the screen words; quotes, commas and formula starts are made safe', () => {
    const csv = csvOf([ROWS[0]!, entry({ seq: 2, reason: 'other: =SUM(A1), "late"', actor_name: '=Ali, Jr', outcome: null, amount_minor: 1250 })], OFFSET);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('﻿Date,Time,Who,Action,Table,Item,Units,Reason,Outcome,Amount,Approver,Method');
    expect(lines[1]).toBe('2026-11-17,21:32,Hamza,Item voided,T12,,1,Customer changed mind,To stock,2400.00,Imran,');
    expect(lines[2]).toBe(`2026-11-17,21:32,"'=Ali, Jr",Item voided,T12,,1,"Other: =SUM(A1), ""late""",,12.50,Imran,`);
    expect(lines.length).toBe(4); // the last line ends with CRLF
  });

  it('a field with a line break or a carriage return is quoted (the line count stays one per entry); Urdu names stay as typed', () => {
    const csv = csvOf(
      [
        entry({ seq: 3, reason: 'other: first line\nsecond line', actor_name: 'حمزہ', approver_name: 'عمران' }),
        entry({ seq: 2, reason: 'other: a\rb', actor_name: 'Ali' }),
      ],
      OFFSET,
    );
    const body = csv.slice(1); // BOM
    expect(body).toContain('"Other: first line\nsecond line"');
    expect(body).toContain('"Other: a\rb"');
    expect(body).toContain(',حمزہ,Item voided,');
    expect(body).toContain(',عمران,');
    // records split on the CRLF ends only: header + 2 entries + the trailing empty piece
    expect(body.split('\r\n').length).toBe(4);
  });

  it('file name: audit-<branch>-<from>-to-<to>.csv, branch as a slug, dates on the hub clock (to = the last whole day)', () => {
    expect(exportFileName('Gulberg', { from: TODAY - 6 * DAY, to: TODAY + DAY }, OFFSET)).toBe('audit-gulberg-2026-11-11-to-2026-11-17.csv');
    expect(exportFileName('DHA Phase 5', { from: TODAY, to: TODAY + DAY }, OFFSET)).toBe('audit-dha-phase-5-2026-11-17-to-2026-11-17.csv');
  });
});

describe('[04 §8; VU2c] Export CSV on the screen', () => {
  it('[04 #60] pages the same query by cursor (limit 200) and saves 2 pages in one file; a toast names the file', async () => {
    const { mm, calls, shell } = render({ first: { entries: ROWS.slice(0, 2), next_cursor: 'C1' }, C1: { entries: ROWS.slice(2), next_cursor: null } });
    await flush();
    const before = calls.length;
    mm.click(mm.button('Export CSV'));
    await flush(10);
    const exportCalls = calls.slice(before);
    expect(exportCalls.map((c) => [c.cursor, c.limit])).toEqual([
      [null, 200],
      ['C1', 200],
    ]);
    for (const c of exportCalls) expect(c.q).toEqual(calls[0]!.q);
    expect(saved.length).toBe(1);
    expect(saved[0]!.name).toBe('audit-gulberg-2026-11-17-to-2026-11-17.csv');
    expect(saved[0]!.text.split('\r\n').length).toBe(ROWS.length + 2);
    expect(shell.toasts.current()).toEqual({ text: 'Saved audit-gulberg-2026-11-17-to-2026-11-17.csv' });
    expect(mm.container.querySelector('.xbar')).toBeNull();
  });

  it('[04 #60; V17] with Staff and Actions set, the export pages the same query: staff_id, the action list and the range', async () => {
    const staff = [{ staff_id: 'S-BILAL', display_name: 'Bilal', in_directory: true }];
    const { mm, calls } = render({ first: { entries: ROWS.slice(0, 2), next_cursor: 'C1' }, C1: { entries: ROWS.slice(2), next_cursor: null } }, staff);
    await flush();
    const flt = (i: number) => mm.container.querySelectorAll<HTMLButtonElement>('.au__bar .flt')[i]!;
    mm.click(flt(1));
    await flush();
    mm.click([...mm.container.querySelectorAll<HTMLElement>('.pop__r')].find((r) => r.textContent === 'BBilal'));
    await flush();
    mm.click(flt(2));
    for (const a of ['Void asked', 'Item voided']) mm.click([...mm.container.querySelectorAll<HTMLElement>('.pop__r')].find((r) => r.textContent === a));
    mm.click(mm.button('Show 2 actions'));
    await flush();
    const before = calls.length;
    mm.click(mm.button('Export CSV'));
    await flush(10);
    const want = { from: TODAY, to: TODAY + DAY, staff_id: 'S-BILAL', actions: ['void_requested', 'item_voided'] };
    expect(calls[before - 1]!.q).toEqual(want);
    expect(calls.slice(before).map((c) => [c.q, c.cursor, c.limit])).toEqual([
      [want, null, 200],
      [want, 'C1', 200],
    ]);
    expect(saved.length).toBe(1);
  });

  it('[frame AuditExport] while it runs: the bar "Exporting… n rows" with progress and Stop; Export reads "Exporting…" and is off; Stop saves nothing', async () => {
    let release: () => void = () => {};
    const { mm, shell } = render({ first: { entries: ROWS.slice(0, 2), next_cursor: 'C1' } });
    const api = shell.api as unknown as AuditApi;
    await flush();
    const real = api.auditLog;
    // the screen reads shell.api at call time: replacing the method changes what the export calls
    api.auditLog = async (q, cursor, limit) => {
      if (limit === 200 && cursor === 'C1') {
        await new Promise<void>((r) => (release = r));
        return { ok: true as const, data: { entries: ROWS.slice(2), next_cursor: null } };
      }
      return real(q, cursor, limit);
    };
    mm.click(mm.button('Export CSV'));
    await flush(6);
    const bar = mm.container.querySelector('.xbar')!;
    expect(bar.textContent).toBe('Exporting… 2 rowsStop');
    expect(bar.querySelector('.trk i')).not.toBeNull();
    const exp = mm.container.querySelector('.au__bar .end .btn')!;
    expect(exp.textContent).toBe('Exporting…');
    expect(exp.getAttribute('aria-disabled')).toBe('true');
    mm.click(mm.button('Stop'));
    release();
    await flush(6);
    expect(saved).toEqual([]);
    expect(mm.container.querySelector('.xbar')).toBeNull();
    expect(mm.container.querySelector('.au__bar .end .btn')?.textContent).toBe('Export CSV');
  });

  it('[04 §8] a failed page stops the export with a warning toast and saves nothing; Export is off with no rows', async () => {
    const { mm, shell } = render({ first: { entries: ROWS.slice(0, 2), next_cursor: 'C1' }, C1: 'network' });
    await flush();
    mm.click(mm.button('Export CSV'));
    await flush(8);
    expect(saved).toEqual([]);
    expect(shell.toasts.current()).toEqual({ text: "Export stopped — the hub can't be reached", tone: 'warn' });
    m?.unmount();
    m = null;
    const empty = render({ first: { entries: [], next_cursor: null } });
    await flush();
    empty.mm.click(empty.mm.button('Export CSV'));
    await flush();
    expect(saved).toEqual([]);
    expect(empty.calls.length).toBe(1);
  });
});
