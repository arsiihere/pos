import type { BranchConfig } from '@pos/events';
import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../../../../app/router';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { useShell } from '../../shell/hooks';
import { orderHref } from '../../shell/routes';
import type { Draft } from '../contracts';
import { MONEY_DIR, money } from '../money';
import { cartCount, cartTotal } from './cart';
import { useDrafts } from './OrderScreen';
import { toCart } from '../send/send';
import { createStockMirror } from '../live/stock-mirror';
import { newUlid } from '../../../../app/ulid';

// 02-S08 Held (02b §8 Ordering screen "Hold (device draft)"; CHANGES Q11): the orders this person held on this
// screen (drafts of this device and person with `held`), newest first; Resume opens it again (no longer held),
// Discard drops it. A held draft does not keep the table locked (the lock is released when the screen is left).

/** "held 8:02 PM" with the time kept LTR inside an Urdu sentence. */
function heldAt(time: string) {
  const [before, after] = t('held.at').split('{time}');
  return (
    <>
      {before}
      <span dir="ltr" className="num">
        {time}
      </span>
      {after}
    </>
  );
}

export function Held() {
  const shell = useShell();
  const drafts = useDrafts();
  const [list, setList] = useState<Draft[] | null>(null);
  const staffId = shell.me?.staff_id ?? null;
  const deviceId = shell.device.id;
  useEffect(() => {
    if (staffId === null) return;
    let live = true;
    drafts
      .list(deviceId, staffId)
      .then((all) => live && setList(all.filter((d) => d.held).sort((a, b) => b.updated_at - a.updated_at)))
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [drafts, deviceId, staffId]);
  const config: BranchConfig | null = shell.config.snapshot();
  // 01c V20: counts and totals by the day-frozen sale unit, as the cart and the hub bill them (the stock mirror's)
  const mirror = useMemo(() => createStockMirror({ live: shell.live, snapshot: () => shell.config.snapshot(), hubNow: () => shell.clock.nowMs() }), [shell.live, shell.config, shell.clock]);
  useEffect(() => () => mirror.dispose(), [mirror]);
  const units = (id: string) => mirror.saleUnit(id);
  // the round each held dine-in order would be (02-S08 "F2 · Round 3"): the seating's orders + 1
  const [rounds, setRounds] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    for (const d of list ?? []) {
      if (d.order_type !== 'dine_in' || d.seating_id === undefined) continue;
      const seating = d.seating_id;
      void shell.orders.seatingOrders(seating).then((a) => live && a.ok && setRounds((r) => ({ ...r, [seating]: a.data.orders.length + 1 })));
    }
    return () => {
      live = false;
    };
  }, [list, shell.orders]);
  const resume = async (d: Draft) => {
    if (staffId === null) return;
    // one open draft per seating: a dine-in order taken again since (or a comp-it round) gets the held lines added
    const all = await drafts.list(deviceId, staffId).catch(() => [] as Draft[]);
    const open = d.order_type === 'dine_in' ? all.find((x) => !x.held && x.order_type === 'dine_in' && x.seating_id === d.seating_id && x.draft_id !== d.draft_id) : undefined;
    const held = toCart(d.cart, newUlid);
    const into = open === undefined ? null : toCart(open.cart, newUlid);
    if (open !== undefined && held !== null && into !== null) {
      await drafts.put({ ...open, cart: { ...into, lines: [...into.lines, ...held.lines] }, updated_at: Math.floor(shell.clock.nowMs()) }).catch(() => undefined);
      await drafts.remove(d.draft_id).catch(() => undefined);
    } else await drafts.put({ ...d, held: false }).catch(() => undefined);
    navigate(orderHref(d.order_type, d.order_type === 'dine_in' ? (d.seating_id ?? d.draft_id) : d.draft_id));
  };
  const discard = async (d: Draft) => {
    await drafts.remove(d.draft_id).catch(() => undefined);
    setList((l) => (l ?? []).filter((x) => x.draft_id !== d.draft_id));
  };
  const rows = list ?? [];
  const tableName = (table_id: string | undefined): string | null => {
    const map = shell.live.part('tables') as { floors?: Array<{ zones: Array<{ tables: Array<{ table_id: string; name: string }> }> }> } | undefined;
    for (const f of map?.floors ?? []) for (const z of f.zones) for (const tb of z.tables) if (tb.table_id === table_id) return tb.name;
    return null;
  };
  return (
    <section className="lcard">
      <div className="lcard__h">
        <h2>{t('held.title')}</h2>
        <span className="cnt num">{rows.length}</span>
        {shell.me !== null && <span className="end muted">{fill(t('held.only_you'), { name: shell.me.name })}</span>}
      </div>
      <div className="lcard__b">
        {rows.map((d) => {
          const cart = config === null ? null : toCart(d.cart, newUlid);
          const total = cart === null || config === null ? null : cartTotal(config, cart, units);
          const what = d.order_type === 'takeaway' ? t('order.takeaway') + (cart?.takeaway?.customer_name === undefined ? '' : ` · ${cart.takeaway.customer_name}`) : d.order_type === 'parking' ? `${t('order.parking')} · ${cart?.parking?.car_number ?? ''}` : [tableName(d.table_id) ?? t('held.dine_in'), d.seating_id === undefined || rounds[d.seating_id] === undefined ? null : fill(t('order.round'), { n: String(rounds[d.seating_id]) })].filter((x) => x !== null).join(' · ');
          return (
            <div className="ql" key={d.draft_id}>
              <div>
                <b dir="auto">{what}</b>
                <small>
                  {fill(t('cart.items'), { n: String(cart === null ? 0 : cartCount(cart, units)) })} · <span dir={MONEY_DIR}>{total === null ? '—' : money(total)}</span>
                </small>
              </div>
              <span className="t">
                {heldAt(timeText(d.updated_at, shell.clock.utcOffsetMs))}
              </span>
              <div className="ql__b">
                <button type="button" className="btn" onClick={() => void resume(d)}>
                  {t('held.resume')}
                </button>
                <button type="button" className="btn btn--quiet" onClick={() => void discard(d)}>
                  {t('held.discard')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
