import type { LineDetail } from '@pos/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { mount, type Mounted } from '../../../../test/dom';
import type { KdsRow } from '../store';
import { LineRow, type LineRowProps } from './LineRow';

// 03b v1.0.8 §3.3, #70, B2-3 (K2; frames 03b-C01–C05, 03b-B04): one card per line.

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

let m: Mounted;
afterEach(() => m?.unmount());

function show(p: Partial<LineRowProps> & { row: KdsRow }) {
  m = mount();
  m.render(<LineRow nowMs={30_000} utcOffsetMs={0} up compact={false} stationId="ST" hasPrinter={false} {...p} />);
  return m.container.querySelector('article')!;
}

describe('[03b §3.3] line row', () => {
  it('[03b §3.3 B2-3] done_undone → "Tap Done" cue on that row', () => {
    const card = show({ row: row('A', { done_undone: true }) });
    expect(card.classList.contains('s-cue')).toBe(true);
    expect(card.querySelector('.kl__band')?.textContent).toContain("Tap Done when ready — it won't finish by itself");
    m.unmount();
    expect(show({ row: row('B') }).querySelector('.kl__band')).toBeNull();
  });

  it('[03b §3.3] content: identifier kinds, units x item, for / deal, options, notes, Ready-made, return reason, moved time', () => {
    let card = show({
      row: row('A', {}, { identifier: { kind: 'token', token: 12, date: '2026-11-10' }, options: ['No onion', '2 x Extra butter'], kitchen_note: 'less spicy', order_note: 'birthday', for_parent: 'Chicken Karahi Full', from_stock: true }),
    });
    expect(card.querySelector('.kl__n')?.textContent).toBe('#1210 Nov');
    expect(card.querySelector('.kl__it')?.textContent).toBe('2 xNaan');
    expect(card.querySelector('.kl__sub')?.textContent).toBe('for Chicken Karahi Full');
    expect([...card.querySelectorAll('.kl__opts li')].map((li) => li.textContent)).toEqual(['No onion', '2 x Extra butter']);
    expect(card.querySelector('.kl__note')?.textContent).toBe('less spicy');
    expect(card.querySelector('.kl__on')?.textContent).toBe('Order: birthday');
    expect(card.querySelector('.rmd')?.textContent).toBe('Ready-made');
    m.unmount();
    card = show({ row: row('B', {}, { identifier: { kind: 'parking', car_number: 'LEB 1234', car_type: 'sedan' }, deal_name: 'Family Deal' }) });
    expect(card.querySelector('.kl__plate')?.textContent).toBe('LEB 1234Sedan');
    expect(card.querySelector('.kl__sub')?.textContent).toBe('(Family Deal)');
    m.unmount();
    card = show({ row: row('C', { mark: 'return' }, { return_of: { order_item_id: 'X', mode: 'remake', item_name: 'Chicken Karahi Half', identifier: { kind: 'table', label: 'T7' } } }) });
    expect(card.classList.contains('s-mark')).toBe(true);
    expect(card.querySelector('.kmk')?.textContent).toBe('RETURN');
    expect(card.querySelector('.kl__why')?.textContent).toBe('Remake · was T7 Chicken Karahi Half');
    m.unmount();
    // 12-hour hub time (01d AD-167): fired 13:44 hub time (UTC+5)
    card = show({ row: row('D', { mark: 'moved', fired_at: Date.UTC(2026, 10, 13, 8, 44) }), utcOffsetMs: 5 * 3_600_000, nowMs: Date.UTC(2026, 10, 13, 8, 45) });
    expect(card.querySelector('.kmk')?.textContent).toBe('MOVED · new time 1:44 PM');
    expect(card.querySelector('.kmk')?.className).toBe('kmk c-danger');
    m.unmount();
    card = show({ row: row('E', { mark: 'pulled' }) });
    expect(card.querySelector('.kmk')?.className).toBe('kmk c-info soft');
    expect(card.classList.contains('s-mark')).toBe(false);
  });

  it('[03b §3.3] the ring: waiting, cooking, late (word, not colour alone), done; a placeholder for a row without details', () => {
    let card = show({ row: row('A', { stage: 'added', fired_at: 0, started_at: null }), nowMs: 70_000 });
    expect(card.querySelector('.ring')?.getAttribute('aria-label')).toBe('waiting 1:10');
    expect(card.querySelector('.ring')?.className).toContain('c-mute');
    m.unmount();
    card = show({ row: row('B', { started_at: 0 }), nowMs: 200_000 });
    expect(card.classList.contains('s-late')).toBe(true);
    expect(card.querySelector('.ring')?.getAttribute('aria-label')).toBe('late +2 min');
    expect(card.querySelector('.ring__in')?.textContent).toBe('+2min late');
    m.unmount();
    card = show({ row: row('C', { stage: 'done', done_at: 10 }) });
    expect(card.classList.contains('s-done')).toBe(true);
    expect(card.querySelector('.ring__in')?.textContent).toBe('done');
    m.unmount();
    card = show({ row: { ...row('D'), detail: null } });
    expect(card.classList.contains('s-ph')).toBe(true);
    expect(card.getAttribute('aria-label')).toBe('Loading…');
  });
});
