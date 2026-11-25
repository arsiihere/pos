import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import type { EtaDraft, EtaPreviewBody } from '../contracts';
import { forgetTakeawayDrafts } from './current-draft';
import { screenHarness } from './screen-harness';
import { at } from './test-fixtures';

// 02b-TK A2 item 5a (frame CartTimeDelta; MAPPING TK-S02 "eta-preview (previous vs new reply → delta), stations-live
// (station full)"): when a cart change moves Ready by later by a minute or more, the line that moved it says why —
// "Mutton Karahi adds 18 min — the Karahi station is full" (its home station's band red), "… is busy" (amber), else
// "… adds 18 min"; the next stable preview clears it.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
const nav = vi.hoisted(() => ({ to: [] as string[] }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: (p: string) => nav.to.push(p) }));

const tick = async (ms = 300) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flush();
};
/** One group with every line, its promise 1:42 PM + `extra` minutes per unit beyond the first. */
const answer = (d: EtaDraft): { ok: true; data: EtaPreviewBody } => {
  const units = d.lines.reduce((n, l) => n + (l.quantity ?? 1), 0);
  const promise = at(13, 42) + (units - 1) * 18 * 60_000;
  return { ok: true, data: { as_of_seq: 1, groups: [{ promise_ms: promise, keys: d.lines.map((l) => l.key) }], lines: d.lines.map((l) => ({ key: l.key, eta_ms: promise, from_stock: false, zone_served: false })) } };
};
const mutton = (m: Mounted) => m.click(m.container.querySelector('.mi[aria-label="Mutton Karahi"]'));
const deltaText = (m: Mounted) => m.container.querySelector('.cart .ln .tk-delta')?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  forgetTakeawayDrafts();
  window.history.replaceState(null, '', '#/takeaway');
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  nav.to = [];
  window.history.replaceState(null, '', '#');
});

describe('[02b-TK TK-S02] the Ready by reason line', () => {
  for (const [band, text] of [
    ['red', 'Mutton Karahi adds 18 min — the Karahi station is full'],
    ['amber', 'Mutton Karahi adds 18 min — the Karahi station is busy'],
    ['green', 'Mutton Karahi adds 18 min'],
  ] as const) {
    it(`[frame CartTimeDelta] the 2nd unit moves Ready by 18 min later; station band ${band}: "${text}"; the next stable preview clears it`, async () => {
      const h = screenHarness({ preview: (d) => answer(d) });
      const m = h.render();
      await flush();
      h.live.frame({ type: 'catch_up', as_of_seq: 2, state: { stations_live: { stations: [{ station_id: 'S1', paused: false, band, wait_ms: 0 }] } } });
      mutton(m);
      await tick();
      expect(deltaText(m)).toBeNull();
      mutton(m);
      await tick();
      expect(deltaText(m)).toBe(text);
      expect(m.container.querySelector('.cart .ln .tk-delta')?.getAttribute('role')).toBe('status');
      // a refetch with the same cart: stable, cleared
      h.live.frame({ type: 'event', seq: 3, event: { event_id: 'E3', event_type: 'StockReserved', schema_version: 1, payload: {} } });
      await tick();
      expect(deltaText(m)).toBeNull();
      m.unmount();
    });
  }
});
