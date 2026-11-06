import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCloudAdmin } from '../../../api/cloud-admin';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { en } from '../../../i18n/en';
import { ur } from '../../../i18n/ur';
import { StationsView } from './StationsView';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  sessionStorage.clear();
});

interface Call {
  method: string;
  url: string;
  key: string | undefined;
  body: unknown;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function fakeApi(handler: (call: Call) => Response) {
  const calls: Call[] = [];
  const api = createCloudAdmin({
    onLoggedOut: () => {},
    fetch: async (url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const call: Call = {
        method: init?.method ?? 'GET',
        url,
        key: headers['Idempotency-Key'],
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      };
      calls.push(call);
      return handler(call);
    },
  });
  return { api, calls };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function setValue(el: HTMLInputElement | HTMLSelectElement | null | undefined, value: string): void {
  if (!el) throw new Error('field missing');
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

function button(label: string, within: ParentNode | null | undefined = container): HTMLButtonElement {
  const found = [...(within ?? container).querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label);
  if (!found) throw new Error(`button ${label} missing`);
  return found;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => el.click());
  await flush();
}

const station = (id: string) => container.querySelector(`[data-station-id="${id}"]`);

async function submit(form: HTMLFormElement | null): Promise<void> {
  if (!form) throw new Error('form missing');
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await flush();
}

// 03a A-1–A-10: the engine fields every station on the wire carries, and the branch's points.
const POINTS = [
  { point_id: 'PT1', name: 'Pass', sort_order: 0, archived_at: null, version: 'v1' },
  { point_id: 'PT2', name: 'Tandoor window', sort_order: 1, archived_at: null, version: 'v2' },
  { point_id: 'PT3', name: 'Old counter', sort_order: 2, archived_at: 5, version: 'v3' },
];
const ENGINE = {
  point_id: 'PT1',
  policy: 'waada_guard',
  freeze_ms: 120_000,
  min_slack_keep_ms: 60_000,
  promise_padding_ms: null,
  pressure_window_ms: 900_000,
  pressure_amber_bp: 8_000,
  pressure_red_bp: 10_000,
  pressure_alert_ms: 300_000,
  pause_enabled: false,
  lane_units: null,
  reserve_units: 0,
  alternates: [] as { alternate_station_id: string; order_types: string[]; home_for_order_types: string[] }[],
  carry_times: [] as { point_id: string; carry_ms: number }[],
};
const KARAHI = {
  ...ENGINE,
  station_id: 'S1',
  name: 'Karahi',
  location_label: null,
  station_type: 'slot',
  capacity: 4,
  freshness_window_ms: null,
  completion_mode: 'two_tap',
  archived_at: null,
  programs: [],
};
const FRYER = {
  ...ENGINE,
  station_id: 'S2',
  name: 'Fryer',
  location_label: 'Back kitchen',
  station_type: 'batch',
  capacity: 8,
  freshness_window_ms: 120_000,
  completion_mode: 'single_tap',
  archived_at: null,
  programs: [{ program_id: 'P1', name: 'Fry 180 °C', cook_time_ms: 360_000, archived_at: null }],
};

describe('owner stations view', () => {
  it('[01a §8.1] a refused edit shows the saved value again, not the refused text', async () => {
    const { api } = fakeApi((call) => {
      if (call.method === 'GET') return json(200, { data: { stations: [KARAHI], points: POINTS } });
      return json(409, { error: { code: 'CONFIG_NAME_TAKEN', message: 'taken', details: { field: 'name' } } });
    });
    act(() => root.render(<StationsView api={api} branchId="B1" />));
    await flush();

    // v1.1: Edit opens the station; Save station sends the change. A refused save keeps what was typed
    // next to its error (the form is no longer saved field by field on blur).
    await click(button(t('owner.common.edit'), station('S1')));
    const name = container.querySelector<HTMLInputElement>('[data-station-id="S1"] input[name="name"]');
    setValue(name, 'Fryer');
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(container.querySelector('.pos-banner--danger')?.textContent).toContain(t('errors.CONFIG_NAME_TAKEN'));
    expect(container.querySelector<HTMLInputElement>('[data-station-id="S1"] input[name="name"]')?.value).toBe('Fryer');
    expect(container.querySelector('[data-station-id="S1"]')?.textContent).not.toContain(t('common.saved'));
  });

  it('[01a §8.1] freshness field only for batch; programs under batch stations; a 409 shows errors.CONFIG_IN_USE text', async () => {
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'GET' && call.url.startsWith('/v1/admin/menu')) {
        return json(200, {
          data: {
            can_edit_tenant: true,
            tax_classes: [],
            categories: [],
            items: [{ item_id: 'I1', name: 'Paye' }],
            next_cursor: null,
          },
        });
      }
      if (call.method === 'GET') return json(200, { data: { stations: [KARAHI, FRYER], points: POINTS } });
      if (call.method === 'PATCH') {
        return json(409, {
          error: {
            code: 'CONFIG_IN_USE',
            message: 'in use',
            details: { used_by: { entity: 'menu_item', ids: ['I1'] } },
            request_id: 'R1',
          },
        });
      }
      if (call.url.endsWith('/programs')) {
        return json(201, { data: { program: { program_id: 'P2', station_id: 'S2', name: 'Reheat', cook_time_ms: 120_000, archived_at: null } } });
      }
      return json(201, { data: { station: { ...KARAHI, station_id: 'S3', name: 'Grill' } } });
    });
    act(() => root.render(<StationsView api={api} branchId="B1" />));
    await flush();
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/v1/admin/branches/B1/stations' });

    // v1.1: each station opens with Edit (one at a time).
    await click(button(t('owner.common.edit'), station('S1')));
    const slot = station('S1');
    // Freshness only on the batch station, shown in minutes.
    expect(slot?.querySelector('input[name="freshness_minutes"]')).toBeNull();
    // Programs only under the batch station.
    expect(slot?.querySelector('[data-program-id]')).toBeNull();
    expect(slot?.textContent).not.toContain(t('owner.stations.add_program'));
    await click(button(t('common.close'), station('S1')));
    await click(button(t('owner.common.edit'), station('S2')));
    const batch = station('S2');
    expect(batch?.querySelector<HTMLInputElement>('input[name="freshness_minutes"]')?.value).toBe('2');
    expect(batch?.querySelector<HTMLSelectElement>('select[name="completion_mode"]')?.value).toBe('single_tap');
    const program = batch?.querySelector('[data-program-id="P1"]');
    expect(program?.querySelector('strong')?.textContent).toBe('Fry 180 °C');
    expect(program?.textContent).toContain('6 min');

    // The add form (a dialog from the app bar) shows the freshness field only once batch is chosen.
    await click(button(t('owner.stations.add_station'), container.querySelector('.pos-appbar')));
    const addStation = container.querySelector<HTMLFormElement>('form[data-form="add-station"]');
    expect(addStation?.querySelector('input[name="freshness_minutes"]')).toBeNull();
    await click(button(t('owner.stations.type_batch'), addStation));
    expect(addStation?.querySelector('input[name="freshness_minutes"]')).not.toBeNull();
    setValue(addStation?.querySelector<HTMLInputElement>('input[name="name"]'), 'Grill');
    setValue(addStation?.querySelector<HTMLInputElement>('input[name="capacity"]'), '3');
    setValue(addStation?.querySelector<HTMLInputElement>('input[name="freshness_minutes"]'), '1');
    await submit(addStation);
    const created = calls.find((c) => c.method === 'POST' && c.url === '/v1/admin/branches/B1/stations');
    expect(created?.body).toEqual({
      name: 'Grill',
      location_label: null,
      station_type: 'batch',
      capacity: 3,
      freshness_window_ms: 60_000,
      completion_mode: 'two_tap',
    });
    expect(created?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // A program is added under the batch station (its dialog), cook time typed in minutes.
    await click(button(t('owner.stations.add_program'), station('S2')));
    const addProgram = container.querySelector<HTMLFormElement>('[role="dialog"] form[data-form="add-program"]');
    setValue(addProgram?.querySelector<HTMLInputElement>('input[name="name"]'), 'Reheat');
    setValue(addProgram?.querySelector<HTMLInputElement>('input[name="cook_minutes"]'), '2');
    await submit(addProgram ?? null);
    const programPost = calls.find((c) => c.method === 'POST' && c.url.endsWith('/stations/S2/programs'));
    expect(programPost?.body).toEqual({ name: 'Reheat', cook_time_ms: 120_000 });
    expect(programPost?.key).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    // Changing the type of a station with routes → 409 CONFIG_IN_USE → the blocked dialog names the items
    // (S50 b), and the type can no longer be changed.
    await click(button(t('owner.common.edit'), station('S1')));
    await click(button(t('owner.stations.type_batch'), station('S1')));
    await click(button(t('owner.stations.save_station'), station('S1')));
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch).toMatchObject({ url: '/v1/admin/branches/B1/stations/S1', body: { station_type: 'batch' }, key: undefined });
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("The cooking type can't change while items use Karahi");
    expect(dialog?.querySelector('[data-in-use]')?.textContent).toBe('Paye');
    await click(button(t('common.close'), dialog));
    expect(station('S1')?.textContent).toContain(t('owner.stations.type_locked'));
  });

  it('[01a hand-off S04] Archive {station} sits in the open station\'s More menu; a CONFIG_IN_USE answer shows the "Used by" hint with the names', async () => {
    let archiveAnswer: 'in-use' | 'ok' = 'in-use';
    const { api, calls } = fakeApi((call) => {
      if (call.method === 'GET' && call.url.startsWith('/v1/admin/menu')) {
        return json(200, {
          data: {
            can_edit_tenant: true,
            tax_classes: [],
            categories: [],
            items: [
              { item_id: 'I1', name: 'Paye' },
              { item_id: 'I2', name: 'Chicken Biryani · Half' },
            ],
            next_cursor: null,
          },
        });
      }
      if (call.method === 'GET') return json(200, { data: { stations: [KARAHI, FRYER], points: POINTS } });
      if (archiveAnswer === 'in-use') {
        return json(409, {
          error: { code: 'CONFIG_IN_USE', message: 'in use', details: { used_by: { entity: 'menu_item', ids: ['I1', 'I2', 'I9'] } } },
        });
      }
      return json(200, { data: { station: { ...FRYER, archived_at: 5 } } });
    });
    act(() => root.render(<StationsView api={api} branchId="B1" />));
    await flush();

    // A closed station has no More menu; the open one has, with no Archive block at its foot.
    expect(station('S2')?.querySelector('.pos-more')).toBeNull();
    await click(button(t('owner.common.edit'), station('S2')));
    expect(station('S2')?.tagName).toBe('SECTION');
    expect(station('S2')?.textContent).not.toContain(t('owner.stations.archive_station'));
    expect(station('S2')?.querySelector('.pos-hint')).toBeNull();
    const more = station('S2')?.querySelector<HTMLButtonElement>('button.pos-more');
    expect(more?.getAttribute('aria-label')).toBe(fill(t('common.more_for'), { name: 'Fryer' }));
    await click(more as HTMLButtonElement);
    const menu = station('S2')?.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain(t('stations.menu_info'));
    const item = button(fill(t('stations.menu_archive'), { station: 'Fryer' }), menu);
    expect(item.className).toContain('pos-menu__item--danger');
    await click(item);
    const confirm = container.querySelector('[role="dialog"]');
    expect(confirm?.textContent).toContain(fill(t('archive.item_title'), { name: 'Fryer' }));
    await click(button(fill(t('archive.archive_name'), { name: 'Fryer' }), confirm));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({ url: '/v1/admin/branches/B1/stations/S2', body: { archived: true } });
    const blocked = container.querySelector('[role="dialog"]');
    expect(blocked?.textContent).toContain(fill(t('archive.blocked_title'), { name: 'Fryer' }));
    await click(button(t('common.close'), blocked));

    // The station stays open and now names the items that use it.
    const hint = station('S2')?.querySelector<HTMLButtonElement>('button.pos-hint');
    expect(hint?.textContent).toBe(fill(t('stations.used_by_short'), { n: '3' }));
    const names = `Paye, Chicken Biryani · Half, ${fill(t('archive.and_more'), { n: '1' })}`;
    expect(hint?.title).toBe(names);
    expect(hint?.getAttribute('aria-label')).toBe(fill(t('stations.used_by_names'), { n: '3', names }));

    archiveAnswer = 'ok';
    await click(station('S2')?.querySelector<HTMLButtonElement>('button.pos-more') as HTMLButtonElement);
    await click(button(fill(t('stations.menu_archive'), { station: 'Fryer' }), station('S2')?.querySelector('[role="menu"]')));
    await click(button(fill(t('archive.archive_name'), { name: 'Fryer' }), container.querySelector('[role="dialog"]')));
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2);
  });

  it('[01a hand-off S04] Show archived is an app-bar More item; its chip hides archived stations again', async () => {
    const { api } = fakeApi(() => json(200, { data: { stations: [KARAHI, { ...FRYER, archived_at: 9 }], points: POINTS } }));
    act(() => root.render(<StationsView api={api} branchId="B1" />));
    await flush();
    const shown = () => [...container.querySelectorAll<HTMLElement>('[data-station-id]')].map((x) => x.dataset['stationId']);
    expect(shown()).toEqual(['S1']);
    expect(container.querySelector('button[role="switch"]')).toBeNull();
    await click(container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-more') as HTMLButtonElement);
    await click(button(t('owner.common.show_archived'), container.querySelector('.pos-appbar [role="menu"]')));
    expect(shown()).toEqual(['S1', 'S2']);
    expect(station('S2')?.textContent).toContain(t('owner.common.restore'));
    const chip = container.querySelector<HTMLButtonElement>('.pos-appbar button.pos-filterchip');
    expect(chip?.getAttribute('aria-label')).toBe(t('stations.hide_archived'));
    await click(chip as HTMLButtonElement);
    expect(shown()).toEqual(['S1']);
  });
});

describe('owner station form: Timing group (03a A-2–A-10)', () => {
  const TAWA = { ...KARAHI, station_id: 'S4', name: 'Tawa' };
  const OLD = { ...KARAHI, station_id: 'S3', name: 'Old tawa', archived_at: 7 };
  const STATIONS = [KARAHI, FRYER, OLD, TAWA];

  function setup(stations: unknown[], onWrite?: (call: Call) => Response) {
    const made = fakeApi((call) => {
      if (call.method === 'GET') return json(200, { data: { stations, points: POINTS } });
      return onWrite?.(call) ?? json(200, { data: { station: KARAHI } });
    });
    return made;
  }
  const input = (id: string, name: string) => container.querySelector<HTMLInputElement>(`[data-station-id="${id}"] [name="${name}"]`);
  const write = (calls: Call[]) => calls.find((c) => c.method === 'PATCH');

  async function openEditor(api: ReturnType<typeof fakeApi>['api'], id = 'S1') {
    act(() => root.render(<StationsView api={api} branchId="B1" />));
    await flush();
    await click(button(t('owner.common.edit'), station(id)));
  }

  it('[01a §8.1; 03a A-2–A-8] the station form shows every Timing field with its default, times in minutes', async () => {
    const { api } = setup(STATIONS);
    await openEditor(api);
    const group = container.querySelector('[data-group="timing"]');
    expect(group?.querySelector('h3')?.textContent).toBe(t('owner.stations.timing'));
    expect(input('S1', 'point_id')).not.toBeNull();
    expect((input('S1', 'point_id') as unknown as HTMLSelectElement).value).toBe('PT1');
    expect((input('S1', 'policy') as unknown as HTMLSelectElement).value).toBe('waada_guard');
    const values = Object.fromEntries(
      ['freeze', 'slack', 'padding', 'window', 'amber', 'red', 'alert', 'lane', 'reserve'].map((n) => [n, input('S1', n)?.value]),
    );
    expect(values).toEqual({ freeze: '2', slack: '1', padding: '', window: '15', amber: '80', red: '100', alert: '5', lane: '', reserve: '0' });
    expect(group?.querySelector('button[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    // an archived point is not offered for the station's point
    const options = [...(input('S1', 'point_id') as unknown as HTMLSelectElement).options].map((o) => o.value);
    expect(options).toEqual(['PT1', 'PT2']);
  });

  it('[01a §6.9; 03a A-4, A-7] a changed value is sent in ms (percent as basis points); only changed fields are sent', async () => {
    const { api, calls } = setup(STATIONS);
    await openEditor(api);
    setValue(input('S1', 'freeze'), '3');
    setValue(input('S1', 'amber'), '95.5');
    setValue(input('S1', 'padding'), '1.5');
    setValue(input('S1', 'lane'), '2');
    setValue(input('S1', 'policy') as unknown as HTMLSelectElement, 'edf');
    await click(station('S1')?.querySelector('button[role="switch"]') as HTMLButtonElement);
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(write(calls)?.body).toEqual({
      policy: 'edf',
      freeze_ms: 180_000,
      promise_padding_ms: 90_000,
      pressure_amber_bp: 9_550,
      pause_enabled: true,
      lane_units: 2,
    });
  });

  it('[01a §8.1; 03a A-2–A-8] a range error from the server shows under its field and the form keeps the typed value', async () => {
    const { api } = setup(STATIONS, () =>
      json(400, { error: { code: 'VALIDATION_FAILED', message: 'x', details: { issues: [{ path: 'freeze_ms', message: 'Number must be less than or equal to 900000' }] } } }),
    );
    await openEditor(api);
    setValue(input('S1', 'freeze'), '99');
    await click(button(t('owner.stations.save_station'), station('S1')));
    const field = input('S1', 'freeze')?.closest('label');
    expect(field?.className).toContain('pos-field--error');
    expect(field?.textContent).toContain('Number must be less than or equal to 900000');
    expect(input('S1', 'freeze')?.value).toBe('99');
    expect(container.querySelector('.pos-banner--danger')?.textContent).toContain(t('errors.VALIDATION_FAILED'));
  });

  it('[01a §8.1; 03a A-9] the alternates editor offers only active slot stations of the branch, never the station itself', async () => {
    const { api } = setup(STATIONS);
    await openEditor(api);
    const picker = input('S1', 'alternate_add') as unknown as HTMLSelectElement;
    expect([...picker.options].map((o) => o.textContent)).toEqual([t('owner.stations.alternate_pick'), 'Tawa']);
  });

  it('[03a A-9] a batch station has no alternates editor', async () => {
    const { api } = setup(STATIONS);
    await openEditor(api, 'S2');
    expect(container.querySelector('[data-group="alternates"]')).toBeNull();
    expect(container.querySelector('[data-group="carry-times"]')).not.toBeNull();
  });

  it('[03a A-9] adding an alternate sends order_types and home_for_order_types; home stays within order_types', async () => {
    const { api, calls } = setup(STATIONS);
    await openEditor(api);
    setValue(input('S1', 'alternate_add') as unknown as HTMLSelectElement, 'S4');
    const row = () => container.querySelector('[data-alternate-id="S4"]') as HTMLElement;
    const tick = (attr: string, type: string) => row().querySelector<HTMLButtonElement>(`[${attr}="${type}"]`) as HTMLButtonElement;
    await click(tick('data-order-type', 'parking'));
    await click(tick('data-order-type', 'delivery'));
    await click(tick('data-home-type', 'takeaway'));
    await click(tick('data-home-type', 'dine_in'));
    await click(tick('data-order-type', 'dine_in'));
    expect(row().querySelector('[data-home-type="dine_in"]')).toBeNull();
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(write(calls)?.body).toEqual({
      alternates: [{ alternate_station_id: 'S4', order_types: ['takeaway'], home_for_order_types: ['takeaway'] }],
    });
  });

  it('[03a A-9; CL-10] a saved alternate that is archived now is dropped on save, so the resend is not refused', async () => {
    const withAlt = {
      ...KARAHI,
      alternates: [
        { alternate_station_id: 'S3', order_types: ['dine_in'], home_for_order_types: [] },
        { alternate_station_id: 'S4', order_types: ['dine_in'], home_for_order_types: ['dine_in'] },
      ],
    };
    const { api, calls } = setup([withAlt, FRYER, OLD, TAWA]);
    await openEditor(api);
    expect(container.querySelector('[data-alternate-id="S3"]')).toBeNull();
    expect(container.querySelector('[data-alternate-id="S4"]')).not.toBeNull();
    // The drop alone is not an edit (nothing is sent); with another edit it goes out in the same PATCH.
    setValue(input('S1', 'freeze'), '3');
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(write(calls)?.body).toEqual({
      freeze_ms: 180_000,
      alternates: [{ alternate_station_id: 'S4', order_types: ['dine_in'], home_for_order_types: ['dine_in'] }],
    });
  });

  it('[03a A-10] carry times: one minutes box per active point, empty = 0, sent as ms; zero rows are not sent', async () => {
    const withCarry = { ...KARAHI, carry_times: [{ point_id: 'PT1', carry_ms: 30_000 }] };
    const { api, calls } = setup([withCarry, FRYER]);
    await openEditor(api);
    const boxes = [...container.querySelectorAll('[data-carry-point]')].map((x) => (x as HTMLElement).dataset['carryPoint']);
    expect(boxes).toEqual(['PT1', 'PT2']);
    expect(input('S1', 'carry_PT1')?.value).toBe('0.5');
    setValue(input('S1', 'carry_PT2'), '1.5');
    setValue(input('S1', 'carry_PT1'), '');
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(write(calls)?.body).toEqual({ carry_times: [{ point_id: 'PT2', carry_ms: 90_000 }] });
  });

  it('[01a §6.9] 422 CONFIG_REFERENCE_INVALID names the field it refused', async () => {
    const { api } = setup(STATIONS, () =>
      json(422, { error: { code: 'CONFIG_REFERENCE_INVALID', message: 'x', details: { field: 'alternates', reason: 'archived' } } }),
    );
    await openEditor(api);
    setValue(input('S1', 'alternate_add') as unknown as HTMLSelectElement, 'S4');
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(container.querySelector('[data-group="alternates"]')?.textContent).toContain(t('errors.reference.archived'));
  });

  it('[01a §6.9] a text that is not a number is refused before sending', async () => {
    const { api, calls } = setup(STATIONS);
    await openEditor(api);
    setValue(input('S1', 'freeze'), 'abc');
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(write(calls)).toBeUndefined();
    expect(container.querySelector('.pos-banner--danger')?.textContent).toContain(t('errors.VALIDATION_FAILED'));
  });
});

describe('owner station form: C8 review fixes', () => {
  const TAWA = { ...KARAHI, station_id: 'S4', name: 'Tawa' };
  const input = (id: string, name: string) => container.querySelector<HTMLInputElement>(`[data-station-id="${id}"] [name="${name}"]`);
  const patchOf = (calls: Call[]) => calls.find((c) => c.method === 'PATCH');

  function setup(stations: unknown[], onWrite?: (call: Call) => Response) {
    return fakeApi((call) => {
      if (call.method === 'GET' && call.url.startsWith('/v1/admin/menu')) return json(200, { data: { can_edit_tenant: true, tax_classes: [], categories: [], items: [{ item_id: 'I1', name: 'Paye' }], next_cursor: null } });
      if (call.method === 'GET') return json(200, { data: { stations, points: POINTS } });
      return onWrite?.(call) ?? json(200, { data: { station: KARAHI } });
    });
  }
  async function openEditor(api: ReturnType<typeof fakeApi>['api'], id = 'S1') {
    act(() => root.render(<StationsView api={api} branchId="B1" />));
    await flush();
    await click(button(t('owner.common.edit'), station(id)));
  }
  const stationInUse = () => json(409, { error: { code: 'CONFIG_IN_USE', message: 'x', details: { entity: 'station', id: 'S1', used_by: { entity: 'station', ids: ['S4', 'S9'] } } } });

  it('[01a §6.9] archiving a station another station names as alternate lists those stations, not items', async () => {
    const { api, calls } = setup([KARAHI, TAWA], stationInUse);
    await openEditor(api);
    await click(station('S1')?.querySelector<HTMLButtonElement>('button.pos-more') as HTMLButtonElement);
    await click(button(fill(t('stations.menu_archive'), { station: 'Karahi' }), station('S1')?.querySelector('[role="menu"]')));
    await click(button(fill(t('archive.archive_name'), { name: 'Karahi' }), container.querySelector('[role="dialog"]')));
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(fill(t('archive.station_blocked_by_stations'), { n: '2' }));
    expect(dialog?.querySelector('[data-in-use]')?.textContent).toContain('Tawa');
    expect(calls.some((c) => c.url.startsWith('/v1/admin/menu'))).toBe(false);
  });

  it('[01a §6.9] a type change refused for stations that name it as alternate lists those stations', async () => {
    const { api } = setup([KARAHI, TAWA], stationInUse);
    await openEditor(api);
    await click(button(t('owner.stations.type_batch'), station('S1')));
    await click(button(t('owner.stations.save_station'), station('S1')));
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(fill(t('archive.station_blocked_by_stations'), { n: '2' }));
    expect(dialog?.querySelector('[data-in-use]')?.textContent).toContain('Tawa');
  });

  it('[01a §8.1] the busy-check labels state the rules of 03a §3.10 and §3.5.5 in both languages', () => {
    expect(en['owner.stations.pressure_window']).toMatch(/ahead/);
    expect(en['owner.stations.pressure_amber']).toMatch(/capacity/);
    expect(en['owner.stations.pressure_red']).toMatch(/capacity/);
    expect(en['owner.stations.reserve_units']).toMatch(/own order types/);
    for (const key of ['owner.stations.pressure_window', 'owner.stations.pressure_amber', 'owner.stations.pressure_red', 'owner.stations.reserve_units'] as const) {
      expect(ur[key]).toBeDefined();
      expect(ur[key]).not.toBe(en[key]);
    }
    expect(ur['owner.stations.pressure_window']).toContain('آگے');
    expect('owner.stations.point_default' in en).toBe(false);
  });

  it('[03a A-10] a nested refusal carry_times.N.carry_ms reaches the box of the Nth sent row', async () => {
    const { api } = setup([KARAHI, FRYER], () =>
      json(400, { error: { code: 'VALIDATION_FAILED', message: 'x', details: { issues: [{ path: 'carry_times.1.carry_ms', message: 'Number must be less than or equal to 600000' }] } } }),
    );
    await openEditor(api);
    // Boxes are filled PT2 then PT1, so that is the sent order; index 1 is PT1.
    setValue(input('S1', 'carry_PT2'), '20');
    setValue(input('S1', 'carry_PT1'), '1');
    await click(button(t('owner.stations.save_station'), station('S1')));
    const label = (id: string) => container.querySelector(`[data-carry-point="${id}"]`);
    const sentOrder = Object.keys({ PT2: 1, PT1: 1 });
    const second = sentOrder[1] as string;
    expect(label(second)?.className).toContain('pos-field--error');
    expect(label(second)?.textContent).toContain('Number must be less than or equal to 600000');
    expect(label(sentOrder[0] as string)?.className).not.toContain('pos-field--error');
  });

  it('[03a A-9] a nested refusal alternates.N.order_types shows on the Nth sent alternate row', async () => {
    const withAlts = { ...KARAHI, alternates: [{ alternate_station_id: 'S3', order_types: ['dine_in'], home_for_order_types: [] }, { alternate_station_id: 'S4', order_types: ['dine_in'], home_for_order_types: [] }] };
    const gone = { ...KARAHI, station_id: 'S3', name: 'Old', archived_at: 5 };
    const { api } = setup([withAlts, gone, TAWA], () =>
      json(400, { error: { code: 'VALIDATION_FAILED', message: 'x', details: { issues: [{ path: 'alternates.0.order_types', message: 'bad types' }] } } }),
    );
    await openEditor(api);
    setValue(input('S1', 'freeze'), '3');
    await click(button(t('owner.stations.save_station'), station('S1')));
    // S3 is dropped before sending, so sent index 0 is S4.
    expect(container.querySelector('[data-alternate-id="S4"]')?.textContent).toContain('bad types');
  });

  it('[03a A-9] an alternate with no order type is refused before sending, on its row', async () => {
    const { api, calls } = setup([KARAHI, TAWA]);
    await openEditor(api);
    setValue(input('S1', 'alternate_add') as unknown as HTMLSelectElement, 'S4');
    for (const ot of ['dine_in', 'takeaway', 'delivery', 'parking']) {
      await click(container.querySelector(`[data-alternate-id="S4"] [data-order-type="${ot}"]`) as HTMLButtonElement);
    }
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(patchOf(calls)).toBeUndefined();
    expect(container.querySelector('[data-alternate-id="S4"]')?.textContent).toContain(t('owner.stations.alternate_need_type'));
  });

  it('[03a A-4; minor] a stored value that minutes cannot round-trip stays as stored when its box is untouched', async () => {
    const odd = { ...KARAHI, freeze_ms: 20_000, promise_padding_ms: 20_000 };
    const { api, calls } = setup([odd, FRYER]);
    await openEditor(api);
    expect(input('S1', 'freeze')?.value).toBe('0.33');
    setValue(input('S1', 'reserve'), '1');
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(patchOf(calls)?.body).toEqual({ reserve_units: 1 });
  });

  it('[03a A-6, A-8; minor] clearing padding and lane sends null', async () => {
    const set = { ...KARAHI, promise_padding_ms: 60_000, lane_units: 2 };
    const { api, calls } = setup([set, FRYER]);
    await openEditor(api);
    setValue(input('S1', 'padding'), '');
    setValue(input('S1', 'lane'), '');
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(patchOf(calls)?.body).toEqual({ promise_padding_ms: null, lane_units: null });
  });

  it('[03a A-9; CL-10, minor] a station with an archived alternate is not dirty on open; with another edit the drop is sent', async () => {
    const withOld = { ...KARAHI, alternates: [{ alternate_station_id: 'S3', order_types: ['dine_in'], home_for_order_types: [] }] };
    const gone = { ...KARAHI, station_id: 'S3', name: 'Old', archived_at: 5 };
    const { api, calls } = setup([withOld, gone]);
    await openEditor(api);
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(patchOf(calls)).toBeUndefined();
    await click(button(t('owner.common.edit'), station('S1')));
    setValue(input('S1', 'freeze'), '3');
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(patchOf(calls)?.body).toEqual({ freeze_ms: 180_000, alternates: [] });
  });
});

describe('owner station form: C8 review 2', () => {
  const TAWA = { ...KARAHI, station_id: 'S4', name: 'Tawa' };
  const GRILL = { ...KARAHI, station_id: 'S5', name: 'Grill' };
  const input = (id: string, name: string) => container.querySelector<HTMLInputElement>(`[data-station-id="${id}"] [name="${name}"]`);
  const err = (sel: string) => container.querySelector(sel)?.textContent ?? '';

  function setup(stations: unknown[], onWrite?: (call: Call) => Response, stock: { stock_item_id: string; name: string }[] = []) {
    return fakeApi((call) => {
      if (call.method === 'GET' && call.url.startsWith('/v1/admin/menu')) return json(200, { data: { can_edit_tenant: true, tax_classes: [], categories: [], items: [{ item_id: 'I1', name: 'Paye' }], next_cursor: null } });
      if (call.method === 'GET' && call.url.startsWith('/v1/admin/stock-items')) return json(200, { data: { can_edit_tenant: true, stock_items: stock } });
      if (call.method === 'GET') return json(200, { data: { stations, points: POINTS } });
      return onWrite?.(call) ?? json(200, { data: { station: KARAHI } });
    });
  }
  async function openEditor(api: ReturnType<typeof fakeApi>['api']) {
    act(() => root.render(<StationsView api={api} branchId="B1" />));
    await flush();
    await click(button(t('owner.common.edit'), station('S1')));
  }
  const refuse = (path: string, message: string) => () =>
    json(400, { error: { code: 'VALIDATION_FAILED', message: 'x', details: { issues: [{ path, message }] } } });

  it('[03a A-10] a carry refusal stays on the box that was sent when the owner edits the list afterwards', async () => {
    const { api } = setup([KARAHI], refuse('carry_times.0.carry_ms', 'too long'));
    await openEditor(api);
    setValue(input('S1', 'carry_PT1'), '20');
    setValue(input('S1', 'carry_PT2'), '1');
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(err('[data-carry-point="PT1"]')).toContain('too long');
    setValue(input('S1', 'carry_PT1'), '');
    expect(err('[data-carry-point="PT1"]')).toContain('too long');
    expect(err('[data-carry-point="PT2"]')).not.toContain('too long');
  });

  it('[03a A-9] an alternates refusal stays on the row that was sent when another row is removed afterwards', async () => {
    const alt = (id: string) => ({ alternate_station_id: id, order_types: ['dine_in'], home_for_order_types: [] });
    const { api } = setup([{ ...KARAHI, alternates: [alt('S4'), alt('S5')] }, TAWA, GRILL], refuse('alternates.0.order_types', 'bad types'));
    await openEditor(api);
    setValue(input('S1', 'freeze'), '3');
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(err('[data-alternate-id="S4"]')).toContain('bad types');
    await click(container.querySelector('[data-alternate-id="S4"] button[aria-label]') as HTMLButtonElement);
    expect(container.querySelector('[data-alternate-id="S4"]')).toBeNull();
    expect(err('[data-alternate-id="S5"]')).not.toContain('bad types');
  });

  it('[03a A-10] an untouched carry box keeps its stored ms in the PATCH of another box', async () => {
    const stored = { ...KARAHI, carry_times: [{ point_id: 'PT1', carry_ms: 20_000 }] };
    const { api, calls } = setup([stored]);
    await openEditor(api);
    expect(input('S1', 'carry_PT1')?.value).toBe('0.33');
    setValue(input('S1', 'reserve'), '1');
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ reserve_units: 1 });
    await click(button(t('owner.common.edit'), station('S1')));
    setValue(input('S1', 'carry_PT2'), '1');
    await click(button(t('owner.stations.save_station'), station('S1')));
    expect(calls.filter((c) => c.method === 'PATCH')[1]?.body).toEqual({
      carry_times: [{ point_id: 'PT1', carry_ms: 20_000 }, { point_id: 'PT2', carry_ms: 60_000 }],
    });
  });

  it('[01c V16] archiving a station that stock items are counted at names those stock items, not menu items', async () => {
    const { api, calls } = setup(
      [KARAHI],
      () => json(409, { error: { code: 'CONFIG_IN_USE', message: 'x', details: { entity: 'station', id: 'S1', used_by: { entity: 'stock_item', ids: ['K1', 'K2', 'K9'] } } } }),
      [{ stock_item_id: 'K1', name: 'Marinade' }, { stock_item_id: 'K2', name: 'Degh rice' }],
    );
    await openEditor(api);
    await click(station('S1')?.querySelector<HTMLButtonElement>('button.pos-more') as HTMLButtonElement);
    await click(button(fill(t('stations.menu_archive'), { station: 'Karahi' }), station('S1')?.querySelector('[role="menu"]')));
    await click(button(fill(t('archive.archive_name'), { name: 'Karahi' }), container.querySelector('[role="dialog"]')));
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain(fill(t('archive.station_blocked_by_stock'), { n: '3' }));
    expect(dialog?.querySelector('[data-in-use]')?.textContent).toContain('Marinade');
    expect(dialog?.querySelector('[data-in-use]')?.textContent).toContain('Degh rice');
    expect(calls.some((c) => c.url.startsWith('/v1/admin/menu'))).toBe(false);
    expect(button(t('archive.open_stock_items'), dialog as HTMLElement)).toBeTruthy();
    expect(dialog?.textContent).not.toContain(t('archive.open_items'));
  });
});
