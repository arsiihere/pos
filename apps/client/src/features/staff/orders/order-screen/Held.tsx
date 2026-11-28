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
import { heldOnDevice } from './held-list';
import { hideName, hidePhone } from '../takeaway/mask';
import { TakeawayHome } from '../takeaway/TakeawayHome';
import { TkIco } from '../takeaway/icons';
import { Ico } from '../../../alerts/ui';
import type { Cart } from './cart';

// 02-S08 Held (02b §8 Ordering screen "Hold (device draft)"; CHANGES Q11): the orders held on this screen, newest
// first; Resume opens it again (no longer held), Discard drops it. A held draft does not keep the table locked (the
// lock is released when the screen is left).
// 02b-TK C2-5 (02b-tk CHANGES §3 Held, frame HeldDrawer; ruling R3): a counter is shared — everyone signed in on
// this device sees its held takeaway / parking drafts, with who held it and when (held-list.ts); Resume makes the
// draft the resumer's. The customer's name and phone are masked ("U•••", "••• 4567") for anyone without
// view-customer-contact. A held dine-in draft stays with the person who held it.

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

// ⚠️ 02b-TK L-CLIENT-6b item 2 (frame HeldDrawer, MAPPING TK-S04; 02b §8 Held, G-6): opened from the takeaway
// screen, Held is a right drawer OVER the order screen (queue, menu and cart stay behind the scrim), not a page.
// Where the route came from decides: the hash it left (HashChangeEvent.oldURL). Any other way in keeps the page.
let heldFrom: string | null = null;
if (typeof window !== 'undefined')
  window.addEventListener('hashchange', (e) => {
    const to = new URL(e.newURL).hash;
    if (to === '#/held') heldFrom = new URL(e.oldURL).hash.replace(/^#/, '');
  });

/** The route was left from the takeaway order screen (the Takeaway tab or a takeaway draft). */
export function heldOverTakeaway(from: string | null): boolean {
  return from !== null && (from === '/takeaway' || from.startsWith('/takeaway?') || from.startsWith('/order/takeaway/'));
}

export function HeldRoute() {
  if (!heldOverTakeaway(heldFrom)) return <Held />;
  const back = heldFrom!;
  return (
    <>
      <TakeawayHome />
      <Held drawer onClose={() => navigate(back)} />
    </>
  );
}

/** "Half karahi · 4 roghni naan · 2 paye": the held cart's lines as the queue row's summary (≤ 6). */
export function heldSummary(config: BranchConfig | null, cart: Cart | null): string {
  if (config === null || cart === null) return '';
  return cart.lines
    .slice(0, 6)
    .map((l) => {
      const name = l.item_id !== undefined ? (config.items.find((i) => i.item_id === l.item_id)?.name ?? '') : (config.deals.find((d) => d.deal_id === l.deal_id)?.name ?? '');
      return l.quantity !== null && l.quantity > 1 && (l.deal_id !== undefined || config.items.find((i) => i.item_id === l.item_id)?.sale_unit === 'piece') ? `${l.quantity}× ${name}` : name;
    })
    .filter((n) => n !== '')
    .join(' · ');
}

export function Held({ drawer = false, onClose }: { drawer?: boolean; onClose?: () => void } = {}) {
  const shell = useShell();
  const drafts = useDrafts();
  const [list, setList] = useState<Draft[] | null>(null);
  const staffId = shell.me?.staff_id ?? null;
  const deviceId = shell.device.id;
  useEffect(() => {
    if (staffId === null) return;
    let live = true;
    heldOnDevice(drafts, deviceId, staffId)
      .then((all) => live && setList(all))
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
  // who held each one: this person, or a name from the staff roster (read once when another's draft is listed)
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const needNames = (list ?? []).some((d) => d.staff_id !== staffId);
  useEffect(() => {
    if (!needNames || names.size > 0) return;
    let live = true;
    // a failed or missing roster leaves the names out (the row still shows when it was held)
    void Promise.resolve()
      .then(() => shell.api.roster())
      .then((a) => live && a.ok && setNames(new Map(a.data.staff.map((p) => [p.staff_id, p.display_name]))))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [needNames, names.size, shell.api]);
  const heldBy = (d: Draft) => (d.staff_id === staffId ? (shell.me?.name ?? null) : (names.get(d.staff_id) ?? null));
  const seesContact = shell.permissions.allowed('view-customer-contact');
  const resume = async (d: Draft) => {
    if (staffId === null) return;
    // another person's held takeaway / parking draft becomes this person's (it is listed under their name now)
    if (d.staff_id !== staffId) {
      await drafts.put({ ...d, staff_id: staffId, held: false }).catch(() => undefined);
      return navigate(orderHref(d.order_type, d.draft_id));
    }
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
  if (drawer) {
    const takeaway = rows.filter((d) => d.order_type !== 'dine_in');
    return (
      <>
        <button type="button" className="tk-scrim--fixed" aria-label={t('common.close')} onClick={onClose} />
        <section className="tk-drawer tk-held" role="dialog" aria-modal="true" aria-labelledby="held-t">
          <div className="tk-drawer__h">
            <span className="tk-empty__ic tk-held__ic">
              <TkIco name="pause" />
            </span>
            <h2 id="held-t">
              {t('h.title')} · <span className="num" dir="ltr">{takeaway.length}</span>
            </h2>
            <button type="button" className="tk-x" aria-label={t('common.close')} onClick={onClose}>
              <Ico name="x" />
            </button>
          </div>
          <div className="tk-drawer__b">
            {takeaway.map((d) => {
              const cart = config === null ? null : toCart(d.cart, newUlid);
              const total = cart === null || config === null ? null : cartTotal(config, cart, units);
              const name = cart?.takeaway?.customer_name === undefined ? null : seesContact ? cart.takeaway.customer_name : hideName(cart.takeaway.customer_name);
              const who = d.order_type === 'parking' ? `${t('order.parking')} · ${cart?.parking?.car_number ?? ''}` : (name ?? t('order.takeaway'));
              const by = heldBy(d);
              const time = timeText(d.updated_at, shell.clock.utcOffsetMs);
              const [before, after] = t('h.at').split('{time}');
              return (
                <div className="tk-il tk-held__row" key={d.draft_id} data-draft={d.draft_id}>
                  <span className="tk-tok tk-tok--q">
                    <TkIco name="pause" />
                  </span>
                  <div className="tk-il__n">
                    <b>
                      <bdi>{who}</bdi> · <span dir={MONEY_DIR}>{total === null ? '—' : money(total)}</span>
                    </b>
                    <small>{heldSummary(config, cart)}</small>
                    <small>
                      {before}
                      <span dir="ltr" className="num">
                        {time}
                      </span>
                      {after}
                      {by !== null && <> · {fill(t('h.by'), { name: by })}</>}
                    </small>
                  </div>
                  <button type="button" className="tk-btn tk-btn--primary" onClick={() => void resume(d)}>
                    {t('h.resume')}
                  </button>
                  <button type="button" className="tk-btn tk-btn--quiet tk-held__trash" aria-label={`${t('h.discard')} · ${who}`} onClick={() => void discard(d)}>
                    <TkIco name="trash" />
                  </button>
                </div>
              );
            })}
            {takeaway.length === 0 && list !== null && (
              <div className="tk-empty">
                <b>{t('h.empty')}</b>
              </div>
            )}
            <div className="tk-hint" role="note">
              <TkIco name="info" />
              {t('h.not_kitchen')}
            </div>
          </div>
        </section>
      </>
    );
  }
  return (
    <section className="lcard">
      <div className="lcard__h">
        <h2>{t('held.title')}</h2>
        <span className="cnt num">{rows.length}</span>
        <span className="end muted">{t('h.shared')}</span>
      </div>
      <div className="lcard__b">
        {rows.map((d) => {
          const cart = config === null ? null : toCart(d.cart, newUlid);
          const total = cart === null || config === null ? null : cartTotal(config, cart, units);
          // R3: the name and phone as typed only for view-customer-contact holders
          const name = cart?.takeaway?.customer_name === undefined ? null : seesContact ? cart.takeaway.customer_name : hideName(cart.takeaway.customer_name);
          const phone = cart?.takeaway?.phone === undefined ? null : seesContact ? cart.takeaway.phone : hidePhone(cart.takeaway.phone);
          const by = heldBy(d);
          const what = d.order_type === 'takeaway' ? [t('order.takeaway'), name].filter((x) => x !== null).join(' · ') : d.order_type === 'parking' ? `${t('order.parking')} · ${cart?.parking?.car_number ?? ''}` : [tableName(d.table_id) ?? t('held.dine_in'), d.seating_id === undefined || rounds[d.seating_id] === undefined ? null : fill(t('order.round'), { n: String(rounds[d.seating_id]) })].filter((x) => x !== null).join(' · ');
          return (
            <div className="ql" key={d.draft_id}>
              <div>
                {/* ⚠️ 02b v1.0.30 QK-7 (BUG-24): the customer's name is its own isolated run, never mixed into the label */}
                <b dir="auto">{d.order_type === 'takeaway' && name !== null ? <>{t('order.takeaway')} · <bdi>{name}</bdi></> : what}</b>
                <small>
                  {fill(t('cart.items'), { n: String(cart === null ? 0 : cartCount(cart, units)) })} · <span dir={MONEY_DIR}>{total === null ? '—' : money(total)}</span>
                  {phone !== null && (
                    <>
                      {' · '}
                      <span dir="ltr" className="num">
                        {phone}
                      </span>
                    </>
                  )}
                </small>
                {by !== null && <small dir="auto">{fill(t('h.by'), { name: by })}</small>}
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
