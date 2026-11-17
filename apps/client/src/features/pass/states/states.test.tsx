import { afterEach, describe, expect, it } from 'vitest';
import type { HubResult } from '../../../api/hub-admin';
import { flush, mount, type Mounted } from '../../../../test/dom';
import { ShellContext, type Shell } from '../../staff/shell/hooks';
import { createLiveBus } from '../../staff/shell/live';
import type { PointLine, PointViewBody } from '../contracts';
import { passLiveOf } from '../live';
import { PassScreen } from '../PassScreen';

// 03b v1.0.8 §3.9, §3.10, §8 (P5; frames 03b-B12 PassOffline, 03b-B14 PassReadOnly, 03b-B15 PassArchived, PassLoading):
// the Pass's page states. Socket down → the warn bar, every button off, the cards stay. Signed in without `run-pass` →
// the read-only line and no buttons. The point archived (a Pass command answers 404 POINT_NOT_FOUND, brief B13/B15) →
// the danger line and every action hidden until the next catch-up. Before the first catch-up → skeleton cards.

function line(id: string, stage: PointLine['stage'], station_id = 'ST-T'): PointLine {
  return {
    order_item_id: id,
    order_id: 'O1',
    station_id,
    point_id: 'PT',
    identifier: { kind: 'table', label: 'T4' },
    order_type: 'dine_in',
    item_name: id,
    units: 1,
    line_kind: 'item',
    for_parent: null,
    deal_name: null,
    options: [],
    kitchen_note: null,
    order_note: null,
    return_of: null,
    cook_ms: 1,
    prep_ms: 0,
    from_stock: false,
    placed_by_name: null,
    stage,
    handed_over: false,
  };
}
const VIEW: PointViewBody = {
  point_id: 'PT',
  stations: [
    { station_id: 'ST-T', name: 'Tandoor', lanes: { lanes_on: 2, lane_count: 2 }, dark: false },
    { station_id: 'ST-C', name: 'Cold', lanes: { lanes_on: 1, lane_count: 1 }, dark: false, screenless: true },
  ],
  takeovers: [],
  orders: [{ order_id: 'O1', identifier: { kind: 'table', label: 'T4' }, placed_at: 0, ready: null, lines: [line('NAAN', 'done'), line('RAITA', 'added', 'ST-C')] }],
};

function setup(o: { online?: boolean; runPass?: boolean; answers?: Record<string, Array<HubResult<unknown>>>; catchUp?: boolean } = {}) {
  const live = createLiveBus();
  const sent: string[] = [];
  const shell = {
    live,
    clock: { nowMs: () => 0, utcOffsetMs: 0 },
    api: {
      roster: () => new Promise(() => undefined),
      command: (type: string) => {
        sent.push(type);
        return Promise.resolve(o.answers?.[type]?.shift() ?? { ok: false, error: { kind: 'network' } });
      },
      query: () => Promise.resolve({ ok: false, error: { kind: 'network' } }),
    },
    permissions: { allowed: (p: string) => p === 'run-pass' && o.runPass !== false },
    toasts: { show: () => undefined },
    online: o.online ?? true,
    portrait: false,
    me: { staff_id: 'S1', name: 'Asif' },
  } as unknown as Shell;
  passLiveOf(shell);
  if (o.catchUp !== false) live.frame({ type: 'catch_up', as_of_seq: 1, state: { point_view: VIEW } });
  return { shell, live, sent };
}

let m: Mounted;
afterEach(() => m?.unmount());
function show(shell: Shell) {
  m = mount();
  m.render(
    <ShellContext.Provider value={shell}>
      <PassScreen />
    </ShellContext.Provider>,
  );
}

describe('[03b §8] Pass states', () => {
  it('[03b §8] socket down → offline banner, every button off, cards stay', () => {
    const s = setup({ online: false });
    show(s.shell);
    const bar = m.container.querySelector('main.pass > .warnbar');
    expect(bar?.getAttribute('role')).toBe('status');
    expect(bar?.textContent).toBe('No connection to the hub — reconnecting…Buttons are off; taps are not saved');
    expect(m.container.querySelectorAll('article.pc')).toHaveLength(1);
    const buttons = m.buttons();
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.hasAttribute('disabled'))).toBe(true);
  });

  it('[03b §3.9] signed-in person without run-pass → read-only banner, no buttons', () => {
    const s = setup({ runPass: false });
    show(s.shell);
    expect(m.container.querySelector('main.pass > .ro[role="status"]')?.textContent).toBe('You can see the Pass but not run it. Ask a manager.');
    expect(m.container.querySelectorAll('article.pc')).toHaveLength(1);
    expect(m.buttons()).toHaveLength(0);
    expect(m.container.querySelector('.warnbar')).toBeNull();
  });

  it('[03b §3.10] point archived → danger banner, actions hidden', async () => {
    const s = setup({ answers: { MarkReadyToServe: [{ ok: false, error: { kind: 'api', status: 404, code: 'POINT_NOT_FOUND', details: {} } }] } });
    show(s.shell);
    m.click(m.button('Ready to serve'));
    await flush();
    expect(s.sent).toEqual(['MarkReadyToServe']);
    expect(m.container.querySelector('main.pass > .msg.c-danger[role="alert"]')?.textContent).toBe('This Pass point is archived. Ask a manager to set up this tablet again.');
    expect(m.container.querySelectorAll('article.pc')).toHaveLength(1);
    expect(m.buttons()).toHaveLength(0);
    // a new catch-up (the tablet bound again, or the point back) clears it
    s.live.frame({ type: 'catch_up', as_of_seq: 9, state: { point_view: VIEW } });
    await flush();
    expect(m.container.querySelector('.msg.c-danger')).toBeNull();
    expect(m.buttons().length).toBeGreaterThan(0);
  });

  it('[03b §8] before the first catch-up → skeleton cards (PassLoading)', () => {
    const s = setup({ catchUp: false });
    show(s.shell);
    const sk = [...m.container.querySelectorAll('main.pass .pcards article.pc.pc--sk')];
    expect(sk).toHaveLength(3);
    expect(sk[0]!.getAttribute('aria-hidden')).toBe('true');
    expect([...sk[0]!.querySelectorAll('.sk')].map((e) => e.className)).toEqual(['sk sk--pid', 'sk sk--pl1', 'sk sk--pl2', 'sk sk--pbtn']);
  });
});
