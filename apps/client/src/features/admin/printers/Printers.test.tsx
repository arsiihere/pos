import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { STATUS, fakeHub, ok, refused, result, type Route } from '../kitchen-screens/test-hub';
import { createPrintersApi, type PrintConfig, type TestPrintResult } from './api';
import { PrintersApp } from './Printers';
import { PRINT_CONFIG, PRINT_QUEUE } from './test-data';

let m: Mounted;
// jsdom has no scrollIntoView ("Go to Station outputs" scrolls to #station-outputs)
const scrolled = vi.fn();
const realScroll = Element.prototype.scrollIntoView;

beforeEach(() => {
  scrolled.mockClear();
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled(this.id);
  } as Element['scrollIntoView'];
  sessionStorage.clear();
  sessionStorage.setItem('admin_session_token', 'S1');
  sessionStorage.setItem('admin_staff_id', 'ST1');
  m = mount();
});

afterEach(() => {
  m.unmount();
  vi.useRealTimers();
  Element.prototype.scrollIntoView = realScroll;
});

function setup(routes: Record<string, Route | Response> = {}, config: PrintConfig = PRINT_CONFIG) {
  const hub = fakeHub({
    'GET /admin/queries/print-config': ok(config),
    'GET /admin/queries/print-queue': ok(PRINT_QUEUE),
    'GET /admin/queries/config-status': STATUS,
    ...routes,
  });
  const api = createPrintersApi({ fetch: hub.fetchFn, readDeviceToken: async () => 'TOK', readDeviceId: async () => 'D1', onSignedOut: () => {} });
  m.render(<PrintersApp api={api} />);
  return hub;
}

function card(name: string): HTMLElement {
  const found = [...m.container.querySelectorAll<HTMLElement>('article.pr')].find((a) => a.querySelector('.pr__h strong')?.textContent === name);
  if (found === undefined) throw new Error(`no printer card ${name}`);
  return found;
}

function menuItem(label: string): HTMLElement {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent?.includes(label));
  if (item === undefined) throw new Error(`no menu item ${label}`);
  return item;
}

describe('printers page (03c-S01)', () => {
  it('[03c §3.2] printer cards: connection · address · paper, status chip, used by, USB note, archived', async () => {
    setup();
    await flush();
    const tandoor = card('Tandoor printer');
    expect(tandoor.querySelector('.mono')?.textContent).toBe('LAN · 192.168.1.50:9100 · 80 mm');
    expect(tandoor.querySelector('.pr__h .pos-chip--ok')?.textContent).toBe('Ready');
    expect(tandoor.textContent).toContain('Used by Tandoor (screen, paper if the screen is off), Fryer (screen and paper)');
    expect(tandoor.textContent).toContain('3 may not have printed');
    const cold = card('Cold printer');
    expect(cold.querySelector('.mono')?.textContent).toBe('USB · /dev/pos-printer-cold · 58 mm');
    expect(cold.textContent).toContain('Status unknown');
    expect(cold.textContent).toContain('This printer doesn\'t report status');
    expect(cold.textContent).toContain("USB printers can't tell the hub when they run out of paper.");
    const old = card('Old fryer printer');
    expect(old.classList.contains('pr--off')).toBe(true);
    expect(old.textContent).toContain('Archived');
    expect(old.textContent).toContain('2 waiting');
    expect(old.textContent).toContain('Used by nothing');
    expect(() => m.button('Test print', old)).toThrow();
  });

  it('[03c §6.2] archive in use → 409 CONFIG_IN_USE dialog naming the stations', async () => {
    const hub = setup({
      'POST /admin/commands/save-printer': refused(409, 'CONFIG_IN_USE', { entity: 'printer', id: 'P1', used_by: { entity: 'station', ids: ['S-T', 'S-F'] } }),
    });
    await flush();
    m.click(m.button('More for Tandoor printer'));
    m.click(menuItem('Archive'));
    await flush();
    const dialog = () => m.container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog().textContent).toContain('Archive Tandoor printer? It stops printing.');
    m.click(m.button('Archive', dialog()));
    await flush();
    expect(hub.commands('SavePrinter')).toEqual([
      { printer_id: 'P1', name: 'Tandoor printer', connection: 'lan', address: '192.168.1.50:9100', paper_width_mm: 80, archived: true },
    ]);
    expect(dialog().textContent).toContain('Tandoor and Fryer still use this printer. Change their output first.');
    expect(() => m.button('Archive', dialog())).toThrow();
    m.click(m.button('Close', dialog()));
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    // again, then "Go to Station outputs" closes the dialog (the section itself is A3's)
    m.click(m.button('More for Tandoor printer'));
    m.click(menuItem('Archive'));
    await flush();
    m.click(m.button('Archive', dialog()));
    await flush();
    m.click(m.button('Go to Station outputs', dialog()));
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(scrolled.mock.calls).toEqual([['station-outputs']]);
  });

  it('[03c §6.2] archive with no station using it → saved, one re-read; the card becomes archived', async () => {
    let archived = false;
    const hub = setup({
      'GET /admin/queries/print-config': () =>
        ok(archived ? { ...PRINT_CONFIG, printers: PRINT_CONFIG.printers.map((p) => (p.printer_id === 'P2' ? { ...p, archived_at: 9 } : p)) } : PRINT_CONFIG),
      'POST /admin/commands/save-printer': () => {
        archived = true;
        return result({ printer: {} });
      },
    });
    await flush();
    m.click(m.button('More for Cold printer'));
    m.click(menuItem('Archive'));
    await flush();
    m.click(m.button('Archive', m.container.querySelector('[role="dialog"]')!));
    await flush();
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    // open (1) + the archive dialog's fresh read (1) + one re-read after the command (1)
    expect(hub.reads('/admin/queries/print-config')).toBe(3);
    expect(card('Cold printer').classList.contains('pr--off')).toBe(true);
  });

  it('[03c §6.4] test print → { printed, status, error } shown per result (ok, no status, bad status, busy)', async () => {
    const answers: Array<Response> = [
      ok({ printed: true, status: 'clean', error: null } satisfies TestPrintResult),
      ok({ printed: true, status: 'unknown', error: null } satisfies TestPrintResult),
      ok({ printed: true, status: 'paper_out', error: null } satisfies TestPrintResult),
      ok({ printed: false, status: 'unknown', error: 'busy' } satisfies TestPrintResult),
      // the hub's real error values (print/routes.ts, transport/lan.ts): a code, often with ':' + a detail
      ok({ printed: false, status: 'unknown', error: 'connect_failed:ECONNREFUSED' } satisfies TestPrintResult),
      ok({ printed: false, status: 'unknown', error: 'connect_timeout' } satisfies TestPrintResult),
      ok({ printed: false, status: 'unknown', error: 'write_failed:child_exit' } satisfies TestPrintResult),
      ok({ printed: false, status: 'unknown', error: 'write_timeout' } satisfies TestPrintResult),
      refused(404, 'PRINTER_NOT_FOUND', { printer_id: 'P1' }),
    ];
    const hub = setup({
      'POST /admin/print/test': () => answers.shift()!,
    });
    await flush();
    const shown = () => card('Tandoor printer').querySelector('.tres');
    const expected = [
      ['tres--ok', 'Printed. Status works.', '3 tickets that may not have printed are being reprinted'],
      ['tres--ok', "Printed. This printer doesn't report status.", null],
      ['tres--warn', 'Printed, but the printer reports out of paper', null],
      ['tres--warn', 'The printer is busy printing tickets. Try again in a moment.', null],
      ['tres--danger', "Couldn't print: Can't reach the printer", null],
      ['tres--danger', "Couldn't print: Can't reach the printer", null],
      ['tres--danger', "Couldn't print: Sending failed", null],
      ['tres--danger', "Couldn't print: The printer stopped taking paper", null],
      ['tres--danger', 'This printer was removed or archived — reload', null],
    ] as const;
    for (const [tone, text, detail] of expected) {
      m.click(m.button('Test print', card('Tandoor printer')));
      await flush();
      expect(shown()?.classList.contains(tone)).toBe(true);
      expect(shown()?.querySelector('b')?.textContent).toBe(text);
      expect(shown()?.querySelector('small')?.textContent ?? null).toBe(detail);
    }
    expect(hub.calls.filter((c) => c.path === '/admin/print/test').map((c) => c.body)).toHaveLength(9);
  });

  it('[03c §6.4] while the test runs the card shows "Printing a test…" and the button is busy', async () => {
    let answer: (r: Response) => void = () => {};
    const hub = fakeHub({
      'GET /admin/queries/print-config': ok(PRINT_CONFIG),
      'GET /admin/queries/print-queue': ok(PRINT_QUEUE),
    });
    hub.fetchFn.mockImplementation(async (url: string) => {
      if (url === '/admin/print/test') return new Promise<Response>((r) => (answer = r));
      return url.endsWith('print-config') ? ok(PRINT_CONFIG) : ok(PRINT_QUEUE);
    });
    const api = createPrintersApi({ fetch: hub.fetchFn, readDeviceToken: async () => 'TOK', readDeviceId: async () => 'D1', onSignedOut: () => {} });
    m.render(<PrintersApp api={api} />);
    await flush();
    m.click(m.button('Test print', card('Tandoor printer')));
    await flush();
    expect(card('Tandoor printer').querySelector('.tres--busy b')?.textContent).toBe('Printing a test…');
    expect(m.button('Test print', card('Tandoor printer')).hasAttribute('disabled')).toBe(true);
    await act(async () => answer(ok({ printed: true, status: 'clean', error: null })));
    await flush();
    expect(card('Tandoor printer').querySelector('.tres--ok')).not.toBeNull();
  });

  it('[03c Q-54] no timer: print-config / print-queue read on open, on Reload and once after each own command', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    const hub = setup({
      'POST /admin/print/test': ok({ printed: true, status: 'clean', error: null }),
      'POST /admin/commands/save-printer': result({ printer: {} }),
    });
    await flush();
    const reads = () => [hub.reads('/admin/queries/print-config'), hub.reads('/admin/queries/print-queue')];
    expect(reads()).toEqual([1, 1]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(reads()).toEqual([1, 1]);
    m.click(m.button('Reload'));
    await flush();
    expect(reads()).toEqual([2, 2]);
    m.click(m.button('Test print', card('Tandoor printer')));
    await flush();
    expect(reads()).toEqual([3, 3]);
    // opening Edit reads print-config once (a stale card must not overwrite another admin's change)
    m.click(m.button('Edit', card('Cold printer')));
    await flush();
    expect(reads()).toEqual([4, 3]);
    m.click(m.button('Save', m.container.querySelector('[role="dialog"]')!));
    await flush();
    expect(hub.commands('SavePrinter')).toHaveLength(1);
    expect(reads()).toEqual([5, 4]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(reads()).toEqual([5, 4]);
  });

  it('[03c §8] no printers → "No printers" with Add printer; the add dialog opens', async () => {
    setup({}, { printers: [], station_outputs: PRINT_CONFIG.station_outputs, warnings: [] });
    await flush();
    expect(m.text()).toContain('No printers');
    expect(m.text()).toContain('Every station works on its screen. Add a printer only if you want paper.');
    m.click(m.button('Add printer', m.container.querySelector('.ad-empty')!));
    expect(m.container.querySelector('[role="dialog"]')?.textContent).toContain('Add printer');
  });
  it('[03c §6.7] a queue head error with a detail reads its code: connect_failed:EHOSTUNREACH → "Can\'t reach the printer"', async () => {
    setup({
      'GET /admin/queries/print-queue': ok({
        ...PRINT_QUEUE,
        printers: PRINT_QUEUE.printers.map((p) => (p.printer_id === 'P1' ? { ...p, status: 'offline', waiting: 4, head_error: 'connect_failed:EHOSTUNREACH' } : p)),
      }),
    });
    await flush();
    expect(card('Tandoor printer').querySelector('.pr__facts')?.textContent).toContain("Can't reach the printer");
  });

  it('[03c §6.2] Edit and Archive read print-config first: a printer archived meanwhile is not saved again', async () => {
    let archived = false;
    const hub = setup({
      'GET /admin/queries/print-config': () =>
        ok(archived ? { ...PRINT_CONFIG, printers: PRINT_CONFIG.printers.map((p) => (p.printer_id === 'P2' ? { ...p, archived_at: 9 } : p)) } : PRINT_CONFIG),
    });
    await flush();
    archived = true; // another admin archives Cold printer; this page still shows it live
    m.click(m.button('Edit', card('Cold printer')));
    await flush();
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(m.container.querySelector('.ad-toast')?.textContent).toContain('This printer was removed or archived — reload');
    expect(card('Cold printer').classList.contains('pr--off')).toBe(true);
    expect(hub.commands('SavePrinter')).toEqual([]);
  });

  it('[03c §6.2] Edit opens with the fields another admin saved meanwhile', async () => {
    let renamed = false;
    setup({
      'GET /admin/queries/print-config': () =>
        ok(renamed ? { ...PRINT_CONFIG, printers: PRINT_CONFIG.printers.map((p) => (p.printer_id === 'P1' ? { ...p, address: '192.168.1.77:9100' } : p)) } : PRINT_CONFIG),
    });
    await flush();
    renamed = true;
    m.click(m.button('Edit', card('Tandoor printer')));
    await flush();
    const inputs = m.container.querySelectorAll<HTMLInputElement>('[role="dialog"] input');
    expect(inputs[1]?.value).toBe('192.168.1.77:9100');
  });

  it('[00 M89] without manage-devices (stored, or a 403 on a re-read) the cards are read-only', async () => {
    sessionStorage.setItem('admin_permissions', JSON.stringify({ 'manage-devices': false, 'manage-staff': true }));
    setup();
    await flush();
    expect(() => m.button('Test print', card('Tandoor printer'))).toThrow();
    expect(() => m.button('Add printer')).toThrow();
    m.unmount();

    m = mount();
    sessionStorage.setItem('admin_permissions', JSON.stringify({ 'manage-devices': true }));
    let denied = false;
    setup({
      'GET /admin/queries/print-config': () => (denied ? refused(403, 'PERMISSION_DENIED', { permission: 'manage-devices' }) : ok(PRINT_CONFIG)),
      'POST /admin/print/test': () => {
        denied = true;
        return ok({ printed: true, status: 'clean', error: null });
      },
    });
    await flush();
    m.click(m.button('Test print', card('Tandoor printer')));
    await flush();
    expect(m.text()).toContain('You do not have permission for this. Ask a manager.');
    expect(() => m.button('Test print', card('Tandoor printer'))).toThrow();
    expect(() => m.button('Edit', card('Tandoor printer'))).toThrow();
  });

  it('[03c §6.4 §6.2] a double tap sends one test print and one SavePrinter', async () => {
    const hub = setup();
    await flush();
    const base = hub.fetchFn.getMockImplementation()!;
    const sent: string[] = [];
    let answer: (r: Response) => void = () => {};
    hub.fetchFn.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/admin/print/test' || url === '/admin/commands/save-printer') {
        sent.push(url);
        return new Promise<Response>((r) => (answer = r));
      }
      return base(url, init);
    });
    const test = m.button('Test print', card('Tandoor printer'));
    m.click(test);
    m.click(test);
    await flush();
    expect(sent).toEqual(['/admin/print/test']);
    await act(async () => answer(ok({ printed: true, status: 'clean', error: null })));
    await flush();
    m.click(m.button('Edit', card('Cold printer')));
    await flush();
    const save = m.button('Save', m.container.querySelector('[role="dialog"]')!);
    m.click(save);
    m.click(save);
    await flush();
    expect(sent).toEqual(['/admin/print/test', '/admin/commands/save-printer']);
    await act(async () => answer(result({ printer: {} })));
    await flush();
  });
});
