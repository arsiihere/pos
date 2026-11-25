import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import { forgetTakeawayDrafts } from './current-draft';
import { RUSH_KEY } from './rush';
import { screenHarness } from './screen-harness';
import { aRow, at } from './test-fixtures';

// 02b-TK A2 item 4 (frame HomeRush; MAPPING TK-S01 "rush"; ruling R9 UI only): at 15 open takeaway tokens (the rail's
// open-orders rows) or by the shell's pill, the takeaway screen turns dense — 4-column tiles without photos, the
// customer row folded into one "Name / phone" button, the compact queue — and the shell's pill reads "Rush mode · n".
// "Most ordered this hour" is Part B (top-items, 02b v1.0.25): not here.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const rows = (n: number) => Array.from({ length: n }, (_, i) => aRow({ order_id: `O${i + 1}`, token: i + 1, promise_ms: at(13, 30 + i) }));
const dense = (m: Mounted) => m.container.querySelector('.menu .items--rush') !== null;

beforeEach(() => {
  forgetTakeawayDrafts();
  window.localStorage.clear();
  window.history.replaceState(null, '', '#/takeaway');
});
afterEach(() => {
  document.body.innerHTML = '';
  nav.to = [];
  window.localStorage.clear();
  window.history.replaceState(null, '', '#');
});

describe('[02b-TK R9] rush mode on the takeaway screen', () => {
  it('[frame HomeRush] 15 open tokens: dense tiles, compact queue, "Name / phone" — the pill says Rush mode · 15', async () => {
    const h = screenHarness({ rows: rows(15) });
    const m = h.render();
    await flush();
    expect(dense(m)).toBe(true);
    expect(m.container.querySelector('aside.tk-q.tk-q--compact')).not.toBeNull();
    expect(m.container.querySelector('.cust input[name="customer_name"]')).toBeNull();
    // the folded customer row opens the name / phone fields
    m.click(m.button('Name / phone', m.container.querySelector('.cart')!));
    expect(m.container.querySelector('.cust input[name="customer_name"]')).not.toBeNull();
    expect(h.shell.rush?.get()).toMatchObject({ on: true, count: 15 });
    m.unmount();
    // the screen clears the pill when it goes
    expect(h.shell.rush?.get()).toBeNull();
  });

  it('[frame HomeKiosk] 14 open tokens: the normal layout; the pill shows Live with the count', async () => {
    const h = screenHarness({ rows: rows(14) });
    const m = h.render();
    await flush();
    expect(dense(m)).toBe(false);
    expect(m.container.querySelector('aside.tk-q.tk-q--compact')).toBeNull();
    expect(m.container.querySelector('.cust input[name="customer_name"]')).not.toBeNull();
    expect(h.shell.rush?.get()).toMatchObject({ on: false, count: 14 });
    m.unmount();
  });

  it('[CHANGES §6 Q6 "also a manual toggle on the pill"] the pill switches it by hand; the choice stays on this device', async () => {
    const h = screenHarness({ rows: rows(2) });
    const m = h.render();
    await flush();
    act(() => h.shell.rush!.get()!.toggle());
    await flush();
    expect(dense(m)).toBe(true);
    expect(h.shell.rush?.get()).toMatchObject({ on: true, count: 2 });
    expect(window.localStorage.getItem(RUSH_KEY)).toBe('on');
    m.unmount();
    // a new screen on this device keeps the choice
    const again = screenHarness({ rows: rows(2) });
    const m2 = again.render();
    await flush();
    expect(dense(m2)).toBe(true);
    act(() => again.shell.rush!.get()!.toggle());
    await flush();
    expect(dense(m2)).toBe(false);
    expect(window.localStorage.getItem(RUSH_KEY)).toBe(null);
    m2.unmount();
  });
});
