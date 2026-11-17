import { useEffect, useRef, useState } from 'react';
import type { RequestToAnswerRow, WsAlertClosed } from '@pos/events';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { HANDOVER_KIND } from '../staff/tables/cards/pending-handovers';
import type { AlertRow } from './store';
import { Ico, OpenCard, Ring, RowCard } from './ui';

// 01d §8.1, §6.9 (S02, frames Requests, RequestsEmpty, RequestsTaken, RequestsPortrait): "You can answer"
// (oldest first) and "For your information" (read-only). The list is computed by the hub now (J5), not taken
// from the inbox. A row answered elsewhere shows its result line, then slides out.

export type RequestRow = ReturnType<(typeof RequestToAnswerRow)['parse']>;

export interface RequestView extends RequestRow {
  state: 'open' | 'closed';
  close_reason: AlertRow['close_reason'];
  decision: AlertRow['decision'];
  by_name: string | null;
}

/** How long a request answered elsewhere stays as a closed row before it leaves the list. */
export const LEAVE_MS = 2_500;

/**
 * AD-163 (controller ruling, applied to this list as task 39 asked): the latest server view wins. When the
 * socket holds this alert as a lock-only view (frame, catch-up or `alerts_open`), the fetched card is dropped
 * with the other signed-in fields; a card shows again only when the server sends one. A close from the socket
 * (`alert_closed`) marks the row closed.
 */
export function requestViews(
  fetched: readonly RequestRow[],
  held: ReadonlyMap<string, AlertRow>,
  /** `alert_closed` frames for alerts the store does not hold (a request seen only through this list) */
  closes: ReadonlyMap<string, WsAlertClosed> = new Map(),
): RequestView[] {
  return fetched.map((r) => {
    const h = held.get(r.alert_id);
    const view: RequestView = { ...r, state: 'open', close_reason: null, decision: null, by_name: null };
    if (h !== undefined && h.card === undefined) {
      delete view.card;
      delete view.answers;
      delete view.needs_pin;
      delete view.raised_device_id;
    }
    const c = closes.get(r.alert_id);
    if (h?.state === 'closed') {
      view.state = 'closed';
      view.close_reason = h.close_reason ?? c?.reason ?? null;
      view.decision = h.decision ?? c?.decision ?? null;
      view.by_name = h.by_name ?? c?.by_name ?? null;
    } else if (c !== undefined) {
      view.state = 'closed';
      view.close_reason = c.reason;
      view.decision = c.decision;
      view.by_name = c.by_name;
    }
    return view;
  });
}

/**
 * 02a §6.15 (02a-C02 HandoverAnswer): a handover card's detail line is "3 orders" and its amount (the running
 * total) at the card's end; the card shows `details.item`, so the order count is put there for the card only.
 */
function cardRow(r: RequestView): RequestView {
  const d = r.card?.details;
  if (r.kind !== HANDOVER_KIND || r.card === undefined || d === null || d === undefined || d.quantity === undefined) return r;
  const { quantity, ...rest } = d;
  return { ...r, card: { ...r.card, details: { ...rest, item: fill(t('handover.det.orders'), { n: String(quantity) }) } } };
}

const oldestFirst = (a: RequestView, b: RequestView) => a.raised_at - b.raised_at || (a.alert_id < b.alert_id ? -1 : 1);

export function RequestsToAnswer({
  rows,
  nowMs,
  utcOffsetMs,
  onOpen,
}: {
  rows: readonly RequestView[];
  nowMs: number;
  utcOffsetMs: number;
  onOpen: (row: RequestView) => void;
}) {
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const closedIds = rows.filter((r) => r.state === 'closed').map((r) => r.alert_id).join(',');
  useEffect(() => {
    for (const id of closedIds === '' ? [] : closedIds.split(',')) {
      if (timers.current.has(id)) continue;
      timers.current.set(
        id,
        setTimeout(() => setGone((g) => new Set([...g, id])), LEAVE_MS),
      );
    }
  }, [closedIds]);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const handle of pending.values()) clearTimeout(handle);
    };
  }, []);

  const shown = rows.filter((r) => !gone.has(r.alert_id));
  // can_answer: true wins over set: 'informed' (controller ruling)
  const mine = shown.filter((r) => r.can_answer).sort(oldestFirst);
  const fyi = shown.filter((r) => !r.can_answer).sort(oldestFirst);

  if (shown.length === 0) {
    return (
      <main className="body">
        <section className="lcard">
          <div className="empty">
            <Ring size={96} pct={100} tone="ok">
              <Ico name="shield" className="ico--36 ico--ok" />
            </Ring>
            <b>{t('requests.empty')}</b>
            <span>{t('requests.empty_sub')}</span>
          </div>
        </section>
      </main>
    );
  }

  const item = (r: RequestView, readOnly: boolean) =>
    r.state === 'closed' ? (
      <RowCard key={r.alert_id} row={r} utcOffsetMs={utcOffsetMs} onOpen={() => {}} className="is-leaving" />
    ) : (
      <OpenCard key={r.alert_id} row={cardRow(r)} nowMs={nowMs} utcOffsetMs={utcOffsetMs} readOnly={readOnly} onOpen={() => onOpen(r)} />
    );

  return (
    <main className="body body--two">
      <section className="lcard">
        <div className="lcard__h">
          <h2>{t('requests.can_answer')}</h2>
          <span className="cnt num cnt--hot">{mine.filter((r) => r.state === 'open').length}</span>
          <div className="end" />
        </div>
        <div className="lcard__b">{mine.map((r) => item(r, false))}</div>
      </section>
      <section className="lcard">
        <div className="lcard__h">
          <h2>{t('requests.fyi')}</h2>
          <span className="cnt num">{fyi.filter((r) => r.state === 'open').length}</span>
          <div className="end" />
        </div>
        <div className="lcard__b">{fyi.map((r) => item(r, true))}</div>
      </section>
    </main>
  );
}
