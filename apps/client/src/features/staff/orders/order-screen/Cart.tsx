import type { BranchConfig } from '@pos/events';
import type { ReactNode } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico, Ring } from '../../../alerts/ui';
import { timeText } from '../../../alerts/labels';
import { MONEY_DIR, money } from '../money';
import type { CartGroup, UnitOf } from './cart';
import { CartLineRow, type LineActions, type LineView } from './CartLine';
import { ServeSwitch } from './ServeSwitch';
import type { ServeMode } from '../contracts';

// 02-S05 cart (400 px; handoff Order, OrderEmpty, OrderProblem, OrderOffline): head with the round and count, the
// problem message, groups with their promise ("From the counter · Now", "Food together · 8:27 PM"), the footer with
// "All ready by", the total, Order note · Hold and the one primary button. Send stays on offline (it queues, 26d);
// it is off with an empty cart, a line problem ("Fix n item first") or a lock that does not let this person send.

export interface CartProps {
  config: BranchConfig;
  unitOf: UnitOf;
  utcOffsetMs: number;
  round: number | null;
  count: number;
  groups: Array<{ group: CartGroup; lines: LineView[] }>;
  /** null when a line's money is not known (menu data missing): "—" */
  total_minor: number | null;
  ready_by: number | null;
  /** ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §8 R4; frame PickupLater): the cart has a pickup — "Kitchen times it for" */
  readyLater?: boolean;
  /** ⚠️ 02b v1.0.26 §8 (owner 2026-11-28, QA BUG-5): the preview's Ready by is after the asked pickup */
  pickupLate?: { can_ms: number; asked_ms: number } | null;
  problems: number;
  canSend: boolean;
  /** why Send is off besides problems (dine-in seating not found), or null */
  blocked: string | null;
  /** #36 day not started: replaces the footer's actions (02b-B11); the ready line says "Times show after Start day" */
  day: ReactNode;
  /** 02b-TK C1-2: the takeaway customer row (name / phone) over the lines, or absent */
  customer?: ReactNode;
  /** an info line over the cart (E-7 CompItCart: "…After Send you'll be asked to comp it") */
  info: string | null;
  actions: LineActions;
  onNote(): void;
  onHold(): void;
  onSend(): void;
  /** 02b v1.0.21 §8 (STAB-5): the order's serve switch */
  serve?: { state: ServeMode | 'mixed'; onSet(mode: ServeMode): void } | undefined;
  /** 02b-TK A2 item 5b (frame ServeChoice): the takeaway's plain serve question, in place of the switch */
  serveChoice?: ReactNode;
  /** phone / portrait: the list only (the sticky bar carries Send) */
  bare?: boolean;
  /** 02b-TK C2-3 (frame TokenAddItems): the primary's words in place of Send ("Add to token 53") */
  primary?: string | undefined;
  /**
   * 02b-TK C3-1 (frames HomeKiosk, HomeOffline): a takeaway cart of a take-payment holder — "Send · pay later" (F9, the
   * Send above) and the primary "Send & pay" (F8); offline only pay later, with "Payment needs the hub…".
   */
  pay?: { online: boolean; onSendPay(): void } | undefined;
  /** 02b-TK C3-1: the pay panel over the cart */
  overlay?: ReactNode;
  /** 02b-TK C3-2 (R6): Print check bill of the sent token this cart adds to (an unsent cart has none) */
  checkBill?: ReactNode;
  /**
   * ⚠️ 02b-TK L-CLIENT-4 item 3 (02b v1.0.25 §8; 05 v1.0.35 §6.3a, §8): a takeaway cart labels its own line sum "Items"
   * (it is not computeBill: no tax, service charge or rounding)
   */
  itemsLabel?: boolean;
  /** 02b-TK A2 item 2 (frame KeyboardMode "Hold F4"): the kiosk's keyboard: Hold shows its key */
  holdKey?: boolean;
  /** 02b-TK A2 item 3 (frame HomeRush): the open line's ×2 ×4 ×6 ×8 chips (takeaway) */
  qchips?: boolean;
  /** L-CLIENT-6a item 5 (frame HomeOffline): the hub is away — "Times show when the hub is back" */
  offline?: boolean;
  /** L-CLIENT-6a item 8 (frame CartNote): the order note, shown in a takeaway cart with Edit */
  note?: string | undefined;
}

function GroupHead({ group, utcOffsetMs, takeaway }: { group: CartGroup; utcOffsetMs: number; takeaway: boolean }) {
  if (group.kind === 'counter')
    return (
      <li className="grp">
        <Ico name="tray" />
        {t(takeaway ? 'c.counter' : 'cart.from_counter')}
        <span className="end">
          <b className="num">{t('cart.now')}</b>
        </span>
      </li>
    );
  // L-CLIENT-6a item 5 (frame HomeKiosk): a takeaway's kitchen group reads "From the kitchen · 1:42 PM"
  if (group.kind === 'promise')
    return (
      <li className="grp">
        <Ico name={takeaway ? 'pot' : 'clock'} />
        {t(takeaway ? 'c.kitchen' : 'cart.food_together')}
        <span className="end" dir="ltr">
          <b className="num">{timeText(group.promise_ms, utcOffsetMs)}</b>
        </span>
      </li>
    );
  return (
    <li className="grp">
      <Ico name={takeaway ? 'pot' : 'clock'} />
      {t(takeaway ? 'c.kitchen' : 'cart.food_together')}
    </li>
  );
}

export function sendLabel(p: { problems: number; primary?: string | undefined }): string {
  return p.problems > 0 ? fill(t('cart.fix_first'), { n: String(p.problems) }) : (p.primary ?? t('cart.send'));
}

export function CartList(p: Pick<CartProps, 'config' | 'unitOf' | 'utcOffsetMs' | 'groups' | 'actions' | 'qchips'> & { phoneTakeaway?: boolean; takeaway?: boolean }) {
  // L-CLIENT-6a item 5 (frames HomeKiosk, CartTimeDelta): every takeaway line carries its − n + stepper
  const takeaway = p.takeaway === true || p.phoneTakeaway === true;
  return (
    <ul className="lines">
      {p.groups.length === 0 && (
        <li className="empty">
          <Ring size={80} pct={null} tone="mute">
            <Ico name="tray" />
          </Ring>
          <b>{t('cart.empty')}</b>
        </li>
      )}
      {p.groups.map(({ group, lines }, i) => [
        <GroupHead key={`g${i}`} group={group} utcOffsetMs={p.utcOffsetMs} takeaway={takeaway} />,
        ...lines.map((v) => <CartLineRow key={v.line.key} view={v} config={p.config} unitOf={p.unitOf} utcOffsetMs={p.utcOffsetMs} actions={p.actions} qchips={p.qchips === true} alwaysStepper={takeaway} />),
      ])}
    </ul>
  );
}

export function Cart(p: CartProps) {
  const empty = p.count === 0;
  return (
    <aside className="cart">
      <div className="cart__head">
        <h2>
          {t('cart.title')}
          {p.round !== null && <span className="rnd2">· {fill(t('order.round'), { n: String(p.round) })}</span>}
        </h2>
        <span>{fill(t('cart.items'), { n: String(p.count) })}</span>
      </div>
      {p.customer}
      {p.info !== null && (
        <div className="msg cart__msg c-info" role="status">
          <Ico name="info" />
          <span>{p.info}</span>
        </div>
      )}
      {p.blocked !== null && (
        <div className="msg cart__msg c-warn" role="alert">
          <Ico name="warn" />
          <span>{p.blocked}</span>
        </div>
      )}
      {p.problems > 0 && (
        <div className="msg cart__msg c-danger" role="alert">
          <Ico name="warn" />
          <span>{fill(t('cart.cant_send'), { n: String(p.problems) })}</span>
        </div>
      )}
      {p.pickupLate != null && (
        <div className="msg cart__msg c-warn" role="status" data-pickup-late="">
          <Ico name="clock" />
          <span>{fill(t('c.pick_late'), { can: timeText(p.pickupLate.can_ms, p.utcOffsetMs), asked: timeText(p.pickupLate.asked_ms, p.utcOffsetMs) })}</span>
        </div>
      )}
      <CartList config={p.config} unitOf={p.unitOf} utcOffsetMs={p.utcOffsetMs} groups={p.groups} actions={p.actions} qchips={p.qchips === true} takeaway={p.itemsLabel === true} />
      <div className="cart__foot">
        {p.itemsLabel === true ? (
          // an empty takeaway cart has no time to tell (L-CLIENT-6a item 11): only the line sum
          <ReadyPanel {...p} hideTime={empty && p.day === null} />
        ) : (
        <div className="total">
          <div className={p.readyLater === true ? 'total__ready total__ready--later' : 'total__ready'}>
            <Ring size={56} pct={null} tone={p.ready_by === null ? 'mute' : p.readyLater === true ? 'info' : 'ok'}>
              <Ico name="clock" />
            </Ring>
            {p.ready_by === null ? (
              // 02b-TK C1-1: no day open → "Times show after Start day", not "set when sent"
              <div>{p.day !== null ? t('c.times_day') : t('cart.times_later')}</div>
            ) : (
              <div>
                {t(p.readyLater === true ? 'c.ready_later' : 'cart.all_ready')}
                <b dir="ltr">{timeText(p.ready_by, p.utcOffsetMs)}</b>
              </div>
            )}
          </div>
          <strong dir={MONEY_DIR}>{p.total_minor === null ? '—' : money(p.total_minor)}</strong>
        </div>
        )}
        {p.day !== null ? (
          p.day
        ) : (
          <>
            {p.serve !== undefined && !empty && <ServeSwitch state={p.serve.state} onSet={p.serve.onSet} />}
            {!empty && p.serveChoice}
            {/* L-CLIENT-6a item 8 (frame CartNote): a saved order note shows in the takeaway cart; its button edits it */}
            {p.itemsLabel === true && p.note !== undefined && (
              <div className="tk-note tk-note--set" data-note="">
                <Ico name="note" />
                <span className="tk-note__t" dir="auto">
                  {p.note}
                </span>
              </div>
            )}
            <div className="duo">
              <button type="button" className="btn" onClick={p.onNote}>
                {p.itemsLabel === true ? (
                  <>
                    <Ico name="note" />
                    {t(p.note === undefined ? 'c.note_add' : 'c.note_edit')}
                  </>
                ) : (
                  t('cart.note')
                )}
              </button>
              <button type="button" className="btn" disabled={empty} onClick={p.onHold}>
                {t('cart.hold')}
                {p.holdKey === true && (
                  <>
                    {' '}
                    <span className="tk-kbd" dir="ltr">
                      F4
                    </span>
                  </>
                )}
              </button>
              {/* L-CLIENT-6a item 5: Print check bill sits in the Note · Hold row, so Send keeps its room */}
              {p.itemsLabel === true && p.checkBill}
            </div>
            {p.itemsLabel !== true && p.checkBill}
            {p.pay !== undefined && p.problems === 0 ? (
              <PayActions pay={p.pay} off={empty || !p.canSend} onSend={p.onSend} />
            ) : (
              <button type="button" className="btn btn--primary btn--lg btn--block" disabled={empty || p.problems > 0 || !p.canSend} onClick={p.onSend}>
                <Ico name="send" />
                {sendLabel(p)}
              </button>
            )}
          </>
        )}
      </div>
      {p.overlay}
    </aside>
  );
}

/**
 * L-CLIENT-6a item 5 (frames HomeKiosk, CartTimeDelta, PickupLater, HomeOffline): the takeaway cart's Ready by — a green
 * panel "Ready by · Tell the customer 1:42 PM" with the reason line (what comes from the counter now), blue "Kitchen
 * times it for" with a pickup; without a time it says why (offline, day not started, not previewed yet). Under it the
 * line sum, labelled "Items" (02b v1.0.25 §8; 05 v1.0.35 §6.3a: not computeBill).
 */
function ReadyPanel(p: CartProps & { hideTime?: boolean }) {
  const later = p.readyLater === true;
  const counter = p.groups.find((g) => g.group.kind === 'counter');
  const kitchen = p.groups.some((g) => g.group.kind !== 'counter');
  const reason = counter !== undefined && kitchen && p.ready_by !== null && !later ? `${counter.lines.map((v) => nameOfLine(p.config, v)).join(' + ')}: ${t('cart.now')}` : null;
  const none = p.ready_by === null;
  const cls = ['tk-readyby', none ? 'tk-readyby--none' : later ? 'tk-readyby--later' : null].filter((c) => c !== null).join(' ');
  return (
    <>
      {p.hideTime !== true && (
      <div className={cls} data-ready="">
        <span className="tk-readyby__ic">
          <Ico name={later ? 'phone' : 'clock'} />
        </span>
        <div className="tk-readyby__t">
          {none ? (
            <b>{p.offline === true ? t('c.times_none') : p.day !== null ? t('c.times_day') : t('cart.times_later')}</b>
          ) : (
            <>
              <small>{later ? t('c.ready_later') : `${t('c.ready_by')} · ${t('c.ready_by_sub')}`}</small>
              <b dir="ltr">{timeText(p.ready_by!, p.utcOffsetMs)}</b>
              {reason !== null && <span className="sub">{reason}</span>}
            </>
          )}
        </div>
      </div>
      )}
      <div className="tk-total">
        <span data-items-label="">{t('cart.items_label')}</span>
        <strong className="money" dir={MONEY_DIR}>
          {p.total_minor === null ? '—' : money(p.total_minor)}
        </strong>
      </div>
    </>
  );
}

const nameOfLine = (config: BranchConfig, v: LineView) =>
  v.line.deal_id !== undefined ? (config.deals.find((d) => d.deal_id === v.line.deal_id)?.name ?? '') : (config.items.find((i) => i.item_id === v.line.item_id)?.name ?? '');

/** 02b-TK C3-1 (frames HomeKiosk, HomeOffline): Send · pay later (F9) and Send & pay (F8); offline pay later only. */
function PayActions({ pay, off, onSend }: { pay: NonNullable<CartProps['pay']>; off: boolean; onSend(): void }) {
  return (
    <>
      {!pay.online && <div className="tk-hint tk-hint--warn">{t('c.queued_pay')}</div>}
      <div className={pay.online ? 'tk-acts' : 'tk-acts tk-acts--one'}>
        <button type="button" className={pay.online ? 'tk-btn tk-btn--lg' : 'tk-btn tk-btn--xl tk-btn--primary'} disabled={off} onClick={onSend}>
          {t('c.send_later')} <span className="tk-kbd" dir="ltr">F9</span>
        </button>
        {pay.online && (
          <button type="button" className="tk-btn tk-btn--xl tk-btn--primary" disabled={off} onClick={pay.onSendPay}>
            {t('c.send_pay')} <span className="tk-kbd" dir="ltr">F8</span>
          </button>
        )}
      </div>
    </>
  );
}

/** 02-S10 sticky Send bar: total, "6 items · 8:27 PM", Send. */
export function SendBar(p: Pick<CartProps, 'count' | 'total_minor' | 'ready_by' | 'utcOffsetMs' | 'problems' | 'canSend' | 'onSend' | 'primary' | 'pay'> & { phoneTakeaway?: boolean }) {
  const sub = fill(t('cart.items'), { n: String(p.count) }) + (p.ready_by === null ? '' : ` · ${timeText(p.ready_by, p.utcOffsetMs)}`);
  return (
    <div className={p.phoneTakeaway ? "sbar ph-bar" : "sbar"}>
      <div className="sbar__t">
        {/* ⚠️ 02b-TK L-CLIENT-4 item 3 (02b v1.0.25 §8; 05 v1.0.35 §8): the phone takeaway's line sum is "Items" */}
        {p.phoneTakeaway === true && <span className="muted" data-items-label="">{t('cart.items_label')}</span>}
        <b dir={MONEY_DIR}>{p.total_minor === null ? '—' : money(p.total_minor)}</b>
        <small>
          {p.phoneTakeaway ? (
            <>{t('v.ready_at')} <bdi className="ph-bar__time" dir="ltr">{p.ready_by === null ? '—' : timeText(p.ready_by, p.utcOffsetMs)}</bdi></>
          ) : sub}
        </small>
      </div>
      {p.pay !== undefined && p.problems === 0 ? (
        <>
          <button type="button" className={p.pay.online ? 'btn btn--lg' : 'btn btn--primary btn--lg'} disabled={p.count === 0 || !p.canSend} onClick={p.onSend}>
            {t(p.phoneTakeaway ? 'cart.send_short' : 'c.send_later')}
          </button>
          {p.pay.online && (
            <button type="button" className="btn btn--primary btn--lg" disabled={p.count === 0 || !p.canSend} onClick={p.pay.onSendPay}>
              {t(p.phoneTakeaway ? 'c.phone_pay' : 'c.send_pay')}
            </button>
          )}
        </>
      ) : (
        <button type="button" className="btn btn--primary btn--lg" disabled={p.count === 0 || p.problems > 0 || !p.canSend} onClick={p.onSend}>
          <Ico name="send" />
          {p.problems > 0 ? fill(t('cart.fix_first'), { n: String(p.problems) }) : (p.primary ?? t('cart.send_short'))}
        </button>
      )}
    </div>
  );
}
