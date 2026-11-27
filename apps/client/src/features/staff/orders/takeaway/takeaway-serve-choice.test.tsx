import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flush, type Mounted } from '../../../../../test/dom';
import type { EtaDraft, EtaPreviewBody } from '../contracts';
import { forgetTakeawayDrafts } from './current-draft';
import { screenHarness } from './screen-harness';
import { at } from './test-fixtures';

// 02b-TK A2 item 5b (frame ServeChoice; MAPPING TK-S02 `.tk-serve`; CHANGES §2 "No … Together / As ready"): a takeaway
// cart with something ready now (a ready item, or stock served at once) and something from the kitchen asks one plain
// question in the footer — "Naan is ready now. Give it now?" — with "All together 1:42 PM" (serve_mode sync) and
// "Naan now, rest 1:42 PM" (serve_mode immediate): the same order choice the Together / As ready switch set
// (02b v1.0.21 §8, STAB-5); no new payload. An order with nothing ready now (or only that) asks nothing.

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
const answer = (d: EtaDraft): { ok: true; data: EtaPreviewBody } => ({
  ok: true,
  data: { as_of_seq: 1, groups: [{ promise_ms: at(13, 42), keys: d.lines.map((l) => l.key) }], lines: d.lines.map((l) => ({ key: l.key, eta_ms: at(13, 42), from_stock: false, zone_served: false })) },
});
const tap = (m: Mounted, name: string) => m.click(m.container.querySelector(`.mi[aria-label="${name}"]`));
const sides = (m: Mounted) => m.click(m.button('Sides', m.container.querySelector('.cats')!));
// ⚠️ 02b-TK L-CLIENT-5 item 1: the pickup row shares the .tk-serve band; the question is the other one
const question = (m: Mounted) => m.container.querySelector('.cart .tk-serve:not([data-pickup-row])');

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

describe('[02b-TK TK-S02] the serve question on a mixed takeaway', () => {
  it('[frame ServeChoice] Naan (ready now) + Mutton Karahi: one plain question with the real names and the time; a choice sets serve_mode', async () => {
    const drafts: EtaDraft[] = [];
    const h = screenHarness({
      config: (c) => ({ ...c, items: c.items.map((i) => (i.item_id === 'I5' ? { ...i, is_ready_item: true } : i)) }),
      preview: (d) => {
        drafts.push(d);
        return answer(d);
      },
    });
    const m = h.render();
    await flush();
    tap(m, 'Mutton Karahi');
    await tick();
    expect(question(m)).toBeNull();
    sides(m);
    tap(m, 'Naan');
    await tick();
    const q = question(m)!;
    expect(q.querySelector('b')!.textContent).toBe('Naan is ready now. Give it now?');
    const [together, now] = [...q.querySelectorAll('button')];
    expect(together!.textContent).toBe('All together 1:42 PM');
    expect(now!.textContent).toBe('Naan now, rest 1:42 PM');
    // no Together / As ready jargon on takeaway
    expect(m.container.querySelector('.cart .serve')).toBeNull();
    m.click(now!);
    await tick();
    expect(drafts.at(-1)!.serve_mode).toBe('immediate');
    expect(now!.getAttribute('aria-pressed')).toBe('true');
    expect(together!.getAttribute('aria-pressed')).toBe('false');
    m.click(together!);
    await tick();
    expect(drafts.at(-1)!.serve_mode).toBe('sync');
    expect(together!.getAttribute('aria-pressed')).toBe('true');
    m.unmount();
  });

  it('[frame ServeChoice] two things ready now are named together; only ready-now lines ask nothing', async () => {
    const h = screenHarness({
      config: (c) => ({ ...c, items: c.items.map((i) => (i.item_id === 'I5' || i.item_id === 'I2' ? { ...i, is_ready_item: true } : i)) }),
      preview: (d) => answer(d),
    });
    const m = h.render();
    await flush();
    tap(m, 'Mutton Karahi');
    sides(m);
    tap(m, 'Naan');
    await tick();
    expect(question(m)).toBeNull();
    m.click(m.button('Karahi', m.container.querySelector('.cats')!));
    m.click(m.button('Chicken Karahi · Half'));
    await tick();
    expect(question(m)!.querySelector('b')!.textContent).toBe('Mutton Karahi + Naan are ready now. Give them now?');
    expect(question(m)!.querySelectorAll('button')[1]!.textContent).toBe('Mutton Karahi + Naan now, rest 1:42 PM');
    m.unmount();
  });
});
