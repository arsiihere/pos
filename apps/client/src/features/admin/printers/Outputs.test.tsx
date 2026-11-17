import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { STATUS, fakeHub, ok, refused, result, type Route } from '../kitchen-screens/test-hub';
import { createPrintersApi, type PrintConfig } from './api';
import { PaperPreview, paperLine } from './PaperPreview';
import { PrintersApp } from './Printers';
import { PRINT_CONFIG, PRINT_QUEUE } from './test-data';

let m: Mounted;

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('admin_session_token', 'S1');
  sessionStorage.setItem('admin_staff_id', 'ST1');
  m = mount();
});

afterEach(() => m.unmount());

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

function section(): HTMLElement {
  return m.container.querySelector<HTMLElement>('#station-outputs')!;
}

function row(name: string): HTMLElement {
  const found = [...section().querySelectorAll<HTMLElement>('.pos-list__row')].find((r) => r.querySelector('.pos-list__name strong')?.textContent === name);
  if (found === undefined) throw new Error(`no output row ${name}`);
  return found;
}

function dialog(): HTMLElement {
  return m.container.querySelector<HTMLElement>('[role="dialog"]')!;
}

describe('station outputs (03c-S02, D04) and warnings (03c-B01)', () => {
  it('[03c §3.2] rows read back the 4 options; archived stations are read-only with no printer', async () => {
    setup();
    await flush();
    expect(row('Tandoor').textContent).toContain('Screen, paper if the screen is off');
    expect(row('Tandoor').textContent).toContain('Tandoor printer');
    expect(row('Tandoor').textContent).toContain('taker · order no.');
    expect(row('Fryer').textContent).toContain('Screen and paper');
    expect(row('Cold').textContent).toContain('Paper only');
    expect(row('Karahi').textContent).toContain('Screen only');
    expect(section().querySelector('.pos-list__group')?.textContent).toBe('Archived stations');
    const grill = row('Grill');
    expect(grill.classList.contains('is-muted')).toBe(true);
    expect(grill.textContent).toContain('read-only');
    expect(grill.textContent).toContain('No printer — released when archived');
    expect(grill.querySelector('button')).toBeNull();
  });

  it('[03c §6.3] the editor: Screen only sends printer_id null; a paper option without a printer → "Pick a printer for paper", nothing sent; then SetStationOutput and one re-read', async () => {
    const hub = setup({ 'POST /admin/commands/set-station-output': result({ station_output: {} }) });
    await flush();
    m.click(m.button('Edit', row('Karahi')));
    await flush();
    expect(dialog().textContent).toContain('Karahi · output');
    expect(dialog().querySelector('.mode[aria-pressed="true"]')?.firstChild?.textContent).toBe('Screen only');
    m.click(m.button('Screen and paper', dialog()));
    m.click(m.button('Save', dialog()));
    await flush();
    expect(hub.commands('SetStationOutput')).toEqual([]);
    expect(dialog().querySelector('.pos-field__error')?.textContent).toBe('Pick a printer for paper');
    const select = dialog().querySelector<HTMLSelectElement>('select')!;
    // only active printers are offered
    expect([...select.options].map((o) => o.value)).toEqual(['', 'P1', 'P2']);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, 'P2');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush(1);
    m.click(m.button('Show order taker on the ticket', dialog()));
    // the preview follows the printer's paper (Cold printer: 58 mm = 32 columns)
    expect(dialog().querySelector('.paper .w32')).not.toBeNull();
    m.click(m.button('Save', dialog()));
    await flush();
    expect(hub.commands('SetStationOutput')).toEqual([{ station_id: 'S-K', mode: 'both', printer_id: 'P2', show_taker: false, show_order_id: true }]);
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    // open (1) + the editor's fresh read (1) + one re-read after the command (1)
    expect(hub.reads('/admin/queries/print-config')).toBe(3);

    m.click(m.button('Edit', row('Tandoor')));
    await flush();
    expect(dialog().querySelector('.mode[aria-pressed="true"]')?.firstChild?.textContent).toBe('Screen, paper if the screen is off');
    m.click(m.button('Screen only', dialog()));
    m.click(m.button('Save', dialog()));
    await flush();
    expect(hub.commands('SetStationOutput').at(-1)).toEqual({ station_id: 'S-T', mode: 'screen', printer_id: null, show_taker: true, show_order_id: true });
  });

  it('[03c §6.3] a refused output (404 PRINTER_NOT_FOUND) stays in the dialog with its words', async () => {
    setup({ 'POST /admin/commands/set-station-output': refused(404, 'PRINTER_NOT_FOUND', { printer_id: 'P1' }) });
    await flush();
    m.click(m.button('Edit', row('Fryer')));
    await flush();
    m.click(m.button('Paper only', dialog()));
    m.click(m.button('Save', dialog()));
    await flush();
    expect(dialog().textContent).toContain('This printer was removed or archived — reload');
  });

  it('[03c Q-48] lossy_name warning shows "\'{name}\' …"; without name → the id', async () => {
    const warnings: PrintConfig['warnings'] = [
      { station_id: null, item_id: 'I-DAL', name: 'دال ماش', kind: 'lossy_name' },
      { station_id: null, item_id: 'OPT-9', kind: 'lossy_name' },
      { station_id: 'S-K', kind: 'screen_unused' },
      { station_id: 'S-T', kind: 'fold_skipped' },
      { station_id: 'S-C', kind: 'no_screen' },
      { station_id: 'S-T', kind: 'suspect_waiting' },
      // a station name that loses letters: no item_id, no name → the station's name
      { station_id: 'S-C', kind: 'lossy_name' },
    ];
    setup({}, { ...PRINT_CONFIG, warnings });
    await flush();
    const banners = m.container.querySelector<HTMLElement>('.pos-banners')!;
    expect(banners.textContent).toContain("'دال ماش' has letters the printer can't print.");
    expect(banners.textContent).toContain("'OPT-9' has letters the printer can't print.");
    expect(banners.textContent).toContain('Karahi prints only, but a kitchen screen is paired to it.');
    expect(banners.querySelector('.pos-banner--danger')?.textContent).toContain('A ticket for Tandoor could not be built.');
    expect(banners.textContent).toContain('Cold has a fallback printer but no kitchen screen.');
    expect(banners.textContent).toContain('Tandoor: tickets that may not have printed are waiting');
    expect(banners.textContent).toContain("'Cold' has letters the printer can't print.");
  });

  it('[03c §3.6 03c-C04] paper preview: 48 / 32 columns, bold and x2 lines, lost letters marked "?"', () => {
    expect(paperLine('Tandoor · 2×')).toEqual([{ text: 'Tandoor   2x', lost: false }]);
    expect(paperLine('دال A')).toEqual([
      { text: '???', lost: true },
      { text: ' A', lost: false },
    ]);
    m.render(
      <PaperPreview
        width={80}
        lines={[
          { text: 'KARAHI', bold: true },
          { text: 'T4', x2: true, bold: true },
          { text: 'دال', bold: false },
        ]}
      />,
    );
    const paper = m.container.querySelector('.paper')!;
    expect(paper.querySelector('.w48')).not.toBeNull();
    expect(paper.querySelector('.ln.b')?.textContent).toBe('KARAHI');
    // x2: centred by leading spaces of normal width, the letters double size (2 columns each)
    const x2 = paper.querySelector('.x2')!;
    expect(x2.textContent).toBe('T4');
    expect(x2.parentElement?.firstChild?.textContent).toBe(' '.repeat(22));
    expect(paper.querySelector('.lost')?.textContent).toBe('???');
    expect(paper.querySelector('.cut')).not.toBeNull();
  });
  it('[00 M89] without manage-devices the outputs and the queue are read-only (no Edit, no Cancel)', async () => {
    sessionStorage.setItem('admin_permissions', JSON.stringify({ 'manage-devices': false }));
    setup({
      'GET /admin/queries/print-queue': ok({
        ...PRINT_QUEUE,
        jobs: [
          {
            job_id: 'J1', kind: 'kitchen', printer_id: 'P1', station_id: 'S-T', ticket_id: 'TK', order_id: 'O1', created_at: 1,
            sent_at: null, attempts: 0, last_error: null, is_reprint: false, suspect_at: null, no_printer: false,
          },
        ],
      }),
    });
    await flush();
    expect(section().querySelector('button')).toBeNull();
    expect(m.container.querySelector('[data-section="print-queue"] .pos-list__row button')).toBeNull();
  });
  it('[00 M47 03c §6.3] Save again after a network failure resends the same command_id; a changed payload gets a new one', async () => {
    const answers = [() => new Error('down'), () => new Error('down'), () => result({ station_output: {} })];
    const hub = setup({ 'POST /admin/commands/set-station-output': () => answers.shift()!() });
    await flush();
    m.click(m.button('Edit', row('Fryer')));
    await flush();
    m.click(m.button('Save', dialog()));
    await flush();
    expect(dialog().textContent).toContain('The hub cannot be reached');
    m.click(m.button('Save', dialog()));
    await flush();
    m.click(m.button('Show order number on the ticket', dialog()));
    m.click(m.button('Save', dialog()));
    await flush();
    const ids = hub.calls.filter((c) => c.path === '/admin/commands/set-station-output').map((c) => c.body?.['command_id']);
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).not.toBe(ids[1]);
  });

  it("[03c §6.3] Edit reads print-config first: it opens with another admin's change; a station archived meanwhile opens nothing", async () => {
    let version = 0;
    const fresh = (): PrintConfig =>
      version === 0
        ? PRINT_CONFIG
        : {
            ...PRINT_CONFIG,
            station_outputs: PRINT_CONFIG.station_outputs.map((o) =>
              o.station_id === 'S-K' ? { ...o, mode: 'printer', printer_id: 'P2' } : o.station_id === 'S-F' ? { ...o, archived: true, printer_id: null } : o,
            ),
          };
    const hub = setup({ 'GET /admin/queries/print-config': () => ok(fresh()) });
    await flush();
    version = 1;
    m.click(m.button('Edit', row('Karahi')));
    await flush();
    expect(hub.reads('/admin/queries/print-config')).toBe(2);
    expect(dialog().querySelector('.mode[aria-pressed="true"]')?.firstChild?.textContent).toBe('Paper only');
    expect(dialog().querySelector<HTMLSelectElement>('select')?.value).toBe('P2');
    m.click(m.button('Cancel', dialog()));
    // the row on screen is fresh now too; reopen the stale view to try Fryer
    version = 0;
    m.click(m.button('Reload'));
    await flush();
    version = 1;
    m.click(m.button('Edit', row('Fryer')));
    await flush();
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
    expect(m.container.querySelector('.ad-toast')?.textContent).toContain('This station is no longer there — reload');
    expect(hub.commands('SetStationOutput')).toEqual([]);
  });

  it('[03c §6.3 §6.5] while a station output save or a cancel runs, Cancel / Keep and Escape do nothing', async () => {
    let answer: (r: Response) => void = () => {};
    const hub = setup();
    await flush();
    const base = hub.fetchFn.getMockImplementation()!;
    hub.fetchFn.mockImplementation(async (url: string, init?: RequestInit) =>
      url === '/admin/commands/set-station-output' ? new Promise<Response>((r) => (answer = r)) : base(url, init),
    );
    m.click(m.button('Edit', row('Fryer')));
    await flush();
    m.click(m.button('Save', dialog()));
    await flush();
    expect(m.button('Cancel', dialog()).hasAttribute('disabled')).toBe(true);
    m.key(dialog(), 'Escape');
    expect(m.container.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => answer(result({ station_output: {} })));
    await flush();
    expect(m.container.querySelector('[role="dialog"]')).toBeNull();
  });
});
