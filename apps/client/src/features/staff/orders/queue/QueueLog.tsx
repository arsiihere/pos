// owned by lane Q, task 25c (was the W0.6 stub)
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { navigate } from '../../../../app/router';
import { newUlid } from '../../../../app/ulid';
import { t, type MessageKey } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { timeText } from '../../../alerts/labels';
import { Ico, type IconName } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { orderHref } from '../../shell/routes';
import type { Draft, DraftStore, OrderType, QueueEntry, SubmitLine, SubmitOption, SubmitOrderPayload } from '../contracts';
import { createIdbDraftStore } from '../drafts/idb-drafts';
import { queueOf } from './enqueue';
import { LOG_REASON, type CommandQueue } from './queue';

// 02b v1.0.11 §8 Queue, §3.12 (02-D14, #/queue): what this screen tried to send and the hub did not take. Each row:
// what, why, when, and the actions that can work —
// - the session was gone (signed out, a reload, waited too long): "Send again as {the person signed in now}" (the
//   same command_id: a command the hub had in fact committed comes back as sent, Q-2);
// - the hub refused it ("Seekh Kebab sold out", …): a refused order can be copied once to a new order (new ids);
//   not when the table changed (the old seating is gone);
// - Discard always.

/** Why-codes after which the same command can work when sent again (no hub refusal of the command itself). */
const RESEND = new Set<string>(['SESSION_EXPIRED', 'SESSION_INVALID', 'CLIENT_SESSION_WITHOUT_ACTOR', LOG_REASON.reloaded, LOG_REASON.noSession, LOG_REASON.tooOld]);
const SIGNED_OUT = new Set<string>(['SESSION_EXPIRED', 'SESSION_INVALID', 'CLIENT_SESSION_WITHOUT_ACTOR', LOG_REASON.noSession]);

/** 02b §9 + reused codes a queued SubmitOrder / MarkServed / RequestBill / CleanTable can be refused with. */
const WHY: Partial<Record<string, MessageKey>> = {
  ITEM_SOLD_OUT: 'queue.why.ITEM_SOLD_OUT',
  ITEM_UNAVAILABLE: 'queue.why.ITEM_UNAVAILABLE',
  ITEM_OUT_OF_HOURS: 'queue.why.ITEM_OUT_OF_HOURS',
  STATION_PAUSED: 'queue.why.STATION_PAUSED',
  BUSINESS_DAY_NOT_OPEN: 'queue.why.BUSINESS_DAY_NOT_OPEN',
  MENU_ITEM_NOT_FOUND: 'queue.why.MENU_ITEM_NOT_FOUND',
  DEAL_NOT_FOUND: 'queue.why.DEAL_NOT_FOUND',
  OPTION_CHOICE_INVALID: 'queue.why.OPTION_CHOICE_INVALID',
  ORDER_ITEM_ID_IN_USE: 'queue.why.ORDER_ITEM_ID_IN_USE',
  ORDER_NOT_FOUND: 'queue.why.ORDER_NOT_FOUND',
  ORDER_BILLED: 'queue.why.ORDER_BILLED',
  ITEM_WRONG_STAGE: 'queue.why.ITEM_WRONG_STAGE',
  TABLE_NEEDS_CLEANING: 'queue.why.TABLE_NEEDS_CLEANING',
  TABLE_ALREADY_LOCKED: 'queue.why.TABLE_ALREADY_LOCKED',
  TABLE_NO_ORDERS: 'queue.why.TABLE_NO_ORDERS',
  TABLE_HAS_OPEN_ORDERS: 'queue.why.TABLE_HAS_OPEN_ORDERS',
  PERMISSION_DENIED: 'queue.why.PERMISSION_DENIED',
  VALIDATION_FAILED: 'queue.why.VALIDATION_FAILED',
};

/** Review #165: a dine-in order refused for its seating is not copied onto that seating (02a: NEEDS_CLEANING is
 *  final for the seating; a changed seating is gone): Discard only. */
const SEATING_BOUND = new Set<string>(['TABLE_SEATING_CHANGED', 'TABLE_NEEDS_CLEANING']);

/** Review #165: the entries copied in this page's life (memory), whether or not their copy draft still exists. */
const copiedThisPage = new WeakMap<CommandQueue, Set<string>>();
function copiedOf(queue: CommandQueue): Set<string> {
  let set = copiedThisPage.get(queue);
  if (set === undefined) {
    set = new Set();
    copiedThisPage.set(queue, set);
  }
  return set;
}

/** The menu name of the refused item / deal (`details.item_id | deal_id`) from the branch config, else "an item". */
type MenuNames = { items?: Array<{ item_id: string; name: string; variant_name?: string | null }>; deals?: Array<{ deal_id: string; name: string }> } | null;
function itemName(details: Record<string, unknown> | undefined, menu: MenuNames): string {
  const itemId = details?.['item_id'];
  const dealId = details?.['deal_id'];
  if (typeof itemId === 'string') {
    const item = menu?.items?.find((i) => i.item_id === itemId);
    if (item !== undefined) return item.variant_name ? `${item.name} ${item.variant_name}` : item.name;
  }
  if (typeof dealId === 'string') {
    const deal = menu?.deals?.find((x) => x.deal_id === dealId);
    if (deal !== undefined) return deal.name;
  }
  return t('queue.item');
}

/** Review / 26b: a "Copy to a new order" draft carries the refused order's payload with new ids (the order screen
 *  turns it into its cart). */
export interface QueueCopyCart {
  copy_of: SubmitOrderPayload;
  /** the queue log entry it was copied from (the row shows "Copied", also after the log is opened again) */
  from_entry_id: string;
}

function whyText(e: QueueEntry, name: (staff_id: string) => string, menu: MenuNames): string {
  const reason = e.log_reason ?? '';
  if (SIGNED_OUT.has(reason)) return fill(t('queue.signed_out'), { name: name(e.staff_id) });
  if (reason === LOG_REASON.reloaded) return t('queue.reloaded');
  if (reason === LOG_REASON.tooOld) return t('queue.too_old');
  if (reason === 'TABLE_SEATING_CHANGED') return t('queue.changed');
  const key = WHY[reason] ?? 'queue.why.other';
  return fill(t('queue.refused'), { reason: fill(t(key), { item: itemName(e.log_details, menu) }) });
}

function iconOf(e: QueueEntry): { name: IconName; tone: string } {
  const reason = e.log_reason ?? '';
  if (RESEND.has(reason)) return { name: 'userlock', tone: 'c-danger' };
  if (reason === 'TABLE_SEATING_CHANGED') return { name: 'info', tone: 'c-mute' };
  return { name: 'warn', tone: 'c-warn' };
}

/** A copy of a refused SubmitOrder with every device-minted id new (02b §3.12: "the copy mints new ids"). */
export function copyPayload(p: SubmitOrderPayload, newId: () => string = () => newUlid()): SubmitOrderPayload {
  const option = (o: SubmitOption): SubmitOption => ({ ...o, ...(o.order_item_id === undefined ? {} : { order_item_id: newId() }) });
  const line = (l: SubmitLine): SubmitLine => ({
    ...l,
    order_item_id: newId(),
    ...(l.options === undefined ? {} : { options: l.options.map(option) }),
    ...(l.deal_choices === undefined
      ? {}
      : { deal_choices: l.deal_choices.map((c) => ({ ...c, order_item_id: newId(), ...(c.options === undefined ? {} : { options: c.options.map(option) }) })) }),
  });
  const copy = structuredClone(p);
  return { ...copy, order_id: newId(), lines: copy.lines.map(line) };
}

export interface QueueLogProps {
  /** default: IndexedDB pos-queue drafts */
  drafts?: DraftStore;
}

export function QueueLog({ drafts }: QueueLogProps = {}) {
  const shell = useShell();
  const queue = queueOf(shell.enqueue);
  if (queue === null) return null;
  return <QueueLogView queue={queue} drafts={drafts} />;
}

function QueueLogView({ queue, drafts }: { queue: CommandQueue; drafts: DraftStore | undefined }) {
  const shell = useShell();
  const store = useMemo(() => drafts ?? createIdbDraftStore(), [drafts]);
  const rows = useSyncExternalStore(queue.subscribe, useMemo(() => cachedLog(queue), [queue]));
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  // review #165: one copy per refused order (a double tap, or a second tap later, never makes two drafts)
  const copying = useRef(copiedOf(queue));
  const [copied, setCopied] = useState<ReadonlySet<string>>(() => new Set(copiedOf(queue)));
  const menu = shell.config.snapshot() as MenuNames;
  const meId = shell.me?.staff_id ?? null;
  useEffect(() => {
    if (meId === null) return;
    let live = true;
    void store
      .list(shell.device.id, meId)
      .then((list) => {
        const from = list.map((d) => (d.cart as Partial<QueueCopyCart> | null)?.from_entry_id).filter((id): id is string => typeof id === 'string');
        if (!live || from.length === 0) return;
        for (const id of from) copying.current.add(id);
        setCopied((c) => new Set([...c, ...from]));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [store, shell.device.id, meId]);
  useEffect(() => {
    let live = true;
    void shell.api.roster().then((r) => {
      if (live && r.ok) setNames(new Map(r.data.staff.map((p) => [p.staff_id, p.display_name])));
    });
    return () => {
      live = false;
    };
  }, [shell.api]);
  const name = (staff_id: string) => (shell.me?.staff_id === staff_id ? shell.me.name : (names.get(staff_id) ?? t('bind.someone')));
  const close = () => navigate(shell.device.type === 'cashier_kiosk' ? '/' : '/tables');

  const sendAgain = async (e: QueueEntry) => {
    setBusy(e.entry_id);
    const answer = await queue.sendAgain(e.entry_id);
    setBusy(null);
    if (answer.status === 'sent') shell.toasts.show({ tone: 'ok', text: t('order.toast.all_sent') });
  };
  const copy = async (e: QueueEntry) => {
    const me = shell.me;
    if (me === null || copying.current.has(e.entry_id)) return;
    copying.current.add(e.entry_id);
    const payload = copyPayload(e.payload as SubmitOrderPayload);
    const draft: Draft = {
      draft_id: newUlid(),
      device_id: shell.device.id,
      staff_id: me.staff_id,
      order_type: payload.order_type,
      ...(payload.table_id === undefined ? {} : { table_id: payload.table_id }),
      ...(payload.seating_id === undefined ? {} : { seating_id: payload.seating_id }),
      cart: { copy_of: payload, from_entry_id: e.entry_id } satisfies QueueCopyCart,
      updated_at: shell.clock.nowMs(),
      held: false,
    };
    try {
      await store.put(draft);
    } catch {
      copying.current.delete(e.entry_id);
      shell.toasts.show({ tone: 'warn', text: t('queue.copy_failed') });
      return;
    }
    setCopied((c) => new Set(c).add(e.entry_id));
    const type: OrderType = payload.order_type;
    navigate(orderHref(type, type === 'dine_in' && payload.seating_id !== undefined ? payload.seating_id : draft.draft_id));
  };

  return (
    <div className="scrim">
      <div className="dlg dlg--w" role="dialog" aria-modal="true" aria-labelledby="queue-log-title">
        <div className="dlg__h">
          <div className="dlg__t">
            <h2 id="queue-log-title">{t('queue.title')}</h2>
            <div className="ac__who">{t('queue.sub')}</div>
          </div>
          <button type="button" className="btn btn--icon dlg__x" aria-label={t('common.close')} onClick={close}>
            <Ico name="x" />
          </button>
        </div>
        <div className="pick">
          {rows.map((e) => {
            const icon = iconOf(e);
            const resend = RESEND.has(e.log_reason ?? '');
            // a dine-in order refused because the table changed is not copied onto the old seating: Discard only
            const canCopy = !resend && e.command_type === 'SubmitOrder' && !SEATING_BOUND.has(e.log_reason ?? '') && shell.me !== null;
            return (
              <div key={e.entry_id} className="ql">
                <span className={`ar__ic ${icon.tone}`}>
                  <Ico name={icon.name} />
                </span>
                <div>
                  <b>{e.label}</b>
                  <small>{whyText(e, name, menu)}</small>
                </div>
                <span className="t">{timeText(e.queued_at, shell.clock.utcOffsetMs)}</span>
                <div className="ql__b">
                  {resend && shell.me !== null && (
                    <button type="button" className="btn" disabled={busy !== null} onClick={() => void sendAgain(e)}>
                      <Ico name="send" />
                      {fill(t('queue.send_again_as'), { name: shell.me.name })}
                    </button>
                  )}
                  {canCopy && copied.has(e.entry_id) && (
                    <span className="t">
                      <Ico name="check" />
                      {t('queue.copied')}
                    </span>
                  )}
                  {canCopy && !copied.has(e.entry_id) && (
                    <button type="button" className="btn" onClick={() => void copy(e)}>
                      <Ico name="repeat" />
                      {t('queue.copy')}
                    </button>
                  )}
                  <button type="button" className="btn btn--quiet" disabled={busy === e.entry_id} onClick={() => void queue.discard(e.entry_id)}>
                    <Ico name="x" />
                    {t('queue.discard')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="acts acts--1">
          <button type="button" className="btn" onClick={close}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

/** queue.log() is a fresh array per call: keep one per change for useSyncExternalStore. */
function cachedLog(queue: CommandQueue): () => QueueEntry[] {
  let key = '';
  let rows: QueueEntry[] = [];
  return () => {
    const next = queue.log();
    const k = next.map((e) => `${e.entry_id}:${e.log_reason ?? ''}`).join('|');
    if (k !== key) {
      key = k;
      rows = next;
    }
    return rows;
  };
}

