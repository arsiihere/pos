import type { KdsStationBody, StationPlanBody } from '@pos/events';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { notifySlots, registerLineAction, registerLineTag, type LineActionCtx } from '../slots';
import type { LineDetail } from '@pos/domain';
import type { KdsRow, KdsView } from '../store';
import { COMPACT_QUERY, StationView } from './StationView';

// 03b v1.0.8 §3.3, §8, #70, Q-50 (K2; frames 03b-S01 Kds, Kds1280, KdsRush, KdsEmpty).

function detail(id: string, over: Partial<LineDetail> = {}): LineDetail {
  return {
    order_item_id: id,
    order_id: `O-${id}`,
    station_id: 'ST',
    point_id: 'P1',
    identifier: { kind: 'table', label: `T-${id}` },
    order_type: 'dine_in',
    item_name: 'Naan',
    units: 2,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: [],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 120_000,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    ...over,
  };
}

function row(id: string, over: Partial<KdsRow> = {}, d: Partial<LineDetail> = {}): KdsRow {
  return { order_item_id: id, order_id: `O-${id}`, stage: 'cooking', fired_at: 0, started_at: 0, mark: null, done_undone: false, done_at: null, detail: detail(id, d), ...over };
}

function view(rows: KdsRow[], plan: StationPlanBody | null = null, over: Partial<KdsStationBody> = {}): KdsView {
  const details = new Map(rows.flatMap((r) => (r.detail === null ? [] : [[r.order_item_id, r.detail] as const])));
  for (const l of plan?.lines ?? []) details.set(l.order_item_id, detail(l.order_item_id, { item_name: `Item ${l.order_item_id}` }));
  return {
    station: { station_id: 'ST', day_open: true, sound_volume: 70, has_printer: false, lanes: { lanes_on: 1, lane_count: 1 }, now: [], details: [], ...over },
    details,
    arrived_at: new Map(),
    rows,
    plan,
    archived: null,
  };
}

const plan = (lines: Array<[string, boolean, number, StationPlanBody['lines'][number]['mark']?]>): StationPlanBody => ({
  station_id: 'ST',
  as_of_seq: 1,
  lines: lines.map(([id, frozen, fire, mark]) => ({ order_item_id: id, order_id: `O-${id}`, fire_ms: fire, deadline_ms: fire + 60_000, mark: mark ?? null, frozen })),
});

let m: Mounted;
afterEach(() => {
  m?.unmount();
  vi.unstubAllGlobals();
});

function show(v: KdsView, nowMs = 10_000) {
  m = mount();
  m.render(<StationView view={v} nowMs={nowMs} utcOffsetMs={0} up />);
}
const ids = (sel = '.kcards article') => [...m.container.querySelectorAll(sel)].map((a) => a.getAttribute('data-id'));

describe('[03b §3.3] station view', () => {
  it('[03b #70] Now in append order, Done removes, nothing reorders; mark / return lines on top in red with reason; moved keeps its row with a red tag', () => {
    const a = row('A');
    const b = row('B', { mark: 'moved' });
    const c = row('C', { mark: 'boost' });
    const d = row('D', { mark: 'return' }, { return_of: { order_item_id: 'X', mode: 'fix', item_name: 'Naan', identifier: { kind: 'table', label: 'T1' } } });
    const e = row('E', { stage: 'done', done_at: 5_000 });
    show(view([a, b, c, d, e]));
    expect(ids()).toEqual(['C', 'D', 'A', 'B', 'E']);
    expect(m.container.querySelector('[data-id="D"] .kl__why')?.textContent).toBe('Fix · was T1 Naan');
    expect(m.container.querySelector('[data-id="B"]')?.classList.contains('s-mark')).toBe(true);
    expect(m.container.querySelector('.ksec__h .n')?.textContent).toBe('5');
    // a new line joins at the end; the Done line leaving changes no one else's place
    m.render(<StationView view={view([a, b, c, d, row('F')])} nowMs={10_000} utcOffsetMs={0} up />);
    expect(ids()).toEqual(['C', 'D', 'A', 'B', 'F']);
  });

  it('[03b #70] Next = frozen station_plan lines with "in m:ss"; Later: N counted', () => {
    show(view([row('A')], plan([['N1', true, 60_000], ['N2', true, 110_000, 'moved'], ['L1', false, 400_000], ['L2', false, 500_000]])));
    const next = [...m.container.querySelectorAll('.knx .knr')];
    expect(next.map((n) => n.getAttribute('data-id'))).toEqual(['N1', 'N2']);
    expect(next[0]!.querySelector('.knr__in')?.textContent).toBe('in 0:50to fire');
    expect(next[0]!.querySelector('.knr__it')?.textContent).toBe('2 xItem N1');
    expect(next[1]!.querySelector('.kmk')?.textContent).toBe('MOVED · in 1:40');
    expect(m.container.querySelector('.knx .ksec__h .n')?.textContent).toBe('2');
    expect(m.container.querySelector('.klater')?.textContent).toBe('Later: 2');
  });

  it('[03b Q-50] each row renders lineTags and lineActions(line, { station_id, has_printer, surface: "kds" }) and re-renders on onSlotsChanged', async () => {
    let printed = new Set<string>();
    const seen: LineActionCtx[] = [];
    const offTag = registerLineTag((l) => (printed.has(l.order_item_id) ? { key: 'printed', label: 'Printed' } : null));
    const offAct = registerLineAction((_l, ctx) => {
      seen.push(ctx);
      return ctx.has_printer ? { key: 'reprint', label: 'Reprint', run: async () => ({ toast: 'Reprinting 1 tickets' }) } : null;
    });
    try {
      show(view([row('A'), row('B')], null, { has_printer: true }));
      expect(m.container.querySelectorAll('.ptag')).toHaveLength(0);
      expect(seen[0]).toEqual({ station_id: 'ST', has_printer: true, surface: 'kds' });
      printed = new Set(['B']);
      act(() => notifySlots());
      expect(m.container.querySelector('[data-id="B"] .ptag')?.textContent).toBe('Printed');
      expect(m.container.querySelector('[data-id="A"] .ptag')).toBeNull();
      m.click(m.button('Reprint', m.container.querySelector('[data-id="A"]')!));
      await flush();
      expect(m.container.querySelector('[data-id="A"] .kl__msg')?.textContent).toBe('Reprinting 1 tickets');
      // no printer → no Reprint at all (never greyed)
      m.render(<StationView view={view([row('A')])} nowMs={10_000} utcOffsetMs={0} up />);
      expect(m.buttons().filter((b) => b.textContent === 'Reprint')).toHaveLength(0);
    } finally {
      offTag();
      offAct();
    }
  });

  it('[03b §8] 1920 and 1280 layouts; 12-hour times', () => {
    show(view([row('A')]));
    expect(m.container.querySelector('main')?.className).toBe('kgrid');
    expect(m.container.querySelector('article')?.classList.contains('kl--c')).toBe(false);
    expect(m.container.querySelector('.ring')?.classList.contains('ring--84')).toBe(true);
    m.unmount();
    // the 1280 wall tablet (IR-14: kgrid--1280 from kds-03-additions.css sets 2 columns and a 340 px Next)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === COMPACT_QUERY, addEventListener() {}, removeEventListener() {} }));
    show(view([row('A', { mark: 'moved', fired_at: Date.UTC(2026, 0, 1, 0, 5) })]), Date.UTC(2026, 0, 1, 0, 6));
    expect(m.container.querySelector('main')?.className).toBe('kgrid kgrid--1280');
    expect(m.container.querySelector('article')?.classList.contains('kl--c')).toBe(true);
    expect(m.container.querySelector('.ring')?.classList.contains('ring--76')).toBe(true);
    // 12-hour times: 00:05 hub time → "12:05 AM"
    expect(m.container.querySelector('.kmk')?.textContent).toBe('MOVED · new time 12:05 AM');
  });

  it('[03b §8] empty: nothing in Now or Next → "Nothing to cook right now", the Next column stays', () => {
    show(view([], plan([['L1', false, 400_000]])));
    expect(m.text()).toContain('Nothing to cook right now');
    expect(m.container.querySelector('.knx')).not.toBeNull();
    expect(m.container.querySelector('.klater')?.textContent).toBe('Later: 1');
  });
});
