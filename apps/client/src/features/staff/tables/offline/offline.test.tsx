import { afterEach, describe, expect, it } from 'vitest';
import { flush, mount, type Mounted } from '../../../../../test/dom';
import { ShellContext, type Shell } from '../../shell/hooks';
import { createToastBus } from '../../shell/toast';
import type { Enqueue } from '../contracts';
import { NEEDS_HUB_ACTIONS, needsHub, type TableAction } from './needs-hub';
import { OfflineBar } from './OfflineBar';

// 02a §8 Offline, 02b §8 Queue (02-B02 TableMapOffline / OrderOffline bar, 02a-T01 Toasts).

function fakeQueue(n: number): Enqueue & { set(n: number): void } {
  let count = n;
  const listeners = new Set<() => void>();
  const send = (async () => ({ status: 'needs_hub' })) as unknown as Enqueue;
  return Object.assign(send, {
    pendingFor: () => 0,
    pendingCount: () => count,
    subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
    set(next: number) {
      count = next;
      for (const l of [...listeners]) l();
    },
  });
}

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
});

function show(o: { online: boolean; n: number; variant: 'tables' | 'order' }) {
  const enqueue = fakeQueue(o.n);
  const toasts = createToastBus();
  const shown: string[] = [];
  let shell = { online: o.online, enqueue, toasts: { ...toasts, show: (t: { text: string }) => shown.push(t.text) } } as unknown as Shell;
  m = mount();
  const render = () =>
    m!.render(
      <ShellContext.Provider value={shell}>
        <OfflineBar variant={o.variant} />
      </ShellContext.Provider>,
    );
  render();
  return {
    enqueue,
    shown,
    bar: () => m!.container.querySelector('.warnbar[role="status"]'),
    setOnline(up: boolean) {
      shell = { ...shell, online: up } as Shell;
      render();
    },
  };
}

describe('[02a §8 Offline] offline bar', () => {
  it('[02a §8 Offline] hub offline: last known tables stay; bar "n waiting to send" from Enqueue.pendingCount()', async () => {
    const v = show({ online: false, n: 2, variant: 'tables' });
    expect(v.bar()?.firstChild?.nextSibling?.textContent).toBe('Reconnecting… 2 waiting to send');
    expect(v.bar()?.querySelector('small')?.textContent).toBe('Ask for bill, Clean and Mark served still work');
    v.enqueue.set(0);
    await flush();
    expect(v.bar()?.textContent).toContain('Reconnecting… showing the last known tables');
    // online: no bar; the way back says so once
    v.setOnline(true);
    expect(v.bar()).toBeNull();
    expect(v.shown).toEqual(['Back online']);
  });

  it('[02b §8 Queue] the same bar on order screens: "Reconnecting… 2 orders waiting to send"', () => {
    let v = show({ online: false, n: 2, variant: 'order' });
    expect(v.bar()?.textContent).toContain('Reconnecting… 2 orders waiting to send');
    expect(v.bar()?.querySelector('small')?.textContent).toBe('Send still works — it waits here');
    m!.unmount();
    v = show({ online: false, n: 1, variant: 'order' });
    expect(v.bar()?.textContent).toContain('Reconnecting… 1 order waiting to send');
    m!.unmount();
    v = show({ online: false, n: 0, variant: 'order' });
    expect(v.bar()?.textContent).toContain('Reconnecting…');
    expect(v.bar()?.textContent).not.toContain('waiting');
    // the order screen's bar never toasts (the map's does, once)
    v.setOnline(true);
    expect(v.shown).toEqual([]);
  });
});

describe('[02a §8 Offline] needs the hub', () => {
  it('[02a §8 Offline] needsHub(): true for Open, Take over, Hand over, Force, Move, Merge, Split, Call waiter; false for Ask for bill, Clean', () => {
    const online: TableAction[] = ['open', 'take_over', 'hand_over', 'force_release', 'force_move', 'move', 'merge', 'split', 'call_waiter'];
    for (const a of online) expect(needsHub(a)).toBe(true);
    expect(needsHub('ask_bill')).toBe(false);
    expect(needsHub('clean')).toBe(false);
    expect([...NEEDS_HUB_ACTIONS].sort()).toEqual([...online].sort());
  });
});
