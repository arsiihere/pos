import { useRef, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { HubError } from '../../../../api/hub-admin';
import { timeText } from '../../../alerts/labels';
import { Ico } from '../../../alerts/ui';
import type { SeatingOrder } from '../../orders/contracts';
import { money } from '../../orders/money';
import { useShell } from '../../shell/hooks';
import type { MapTile, SeatingRef, TableMapBody } from '../contracts';
import { MiniTile, freeTilesByFloor } from './Move';
import { DialogFrame } from './TableBusy';

// 02a §3.12, §6.11 (02-D11 Split): `SplitSeating { from_table_id, seating_id, to_table_id, order_ids }`. Step 1 the
// target: a joined table of this party (not the primary) or a FREE table. Step 2 tick whole live orders from 02b's
// `seating-orders` (placer, total); at least one goes and one stays (SPLIT_INVALID). A joined target can instead
// be freed with no orders (`order_ids: []`, detach). Splitting a bill is the cashier's (05).

export interface SplitProps {
  code: string;
  seating: SeatingRef;
  body: TableMapBody | null;
  onClose(): void;
  onSplit(result: { to: MapTile; moved: number }): void;
  onFailed(error: HubError): void;
}

/** Σ billed_minor of the order's lines (= the hub's seatingTotals per order, deal parts 0). */
const orderTotal = (o: SeatingOrder) => o.lines.reduce((n, l) => n + l.billed_minor, 0);
const itemCount = (o: SeatingOrder) => o.lines.filter((l) => l.parent_order_item_id === null).length;

export function Split({ code, seating, body, onClose, onSplit, onFailed }: SplitProps) {
  const { tables, orders, me, clock } = useShell();
  const [to, setTo] = useState<MapTile | null>(null);
  const [live, setLive] = useState<SeatingOrder[] | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [justFree, setJustFree] = useState(false);
  const [busy, setBusy] = useState(false);
  /** one send at a time (a ref: two taps before the re-render cannot both send) */
  const inflight = useRef(false);

  const all = (body?.floors ?? []).flatMap((f) => f.zones.flatMap((z) => z.tables));
  const party = all.filter((x) => x.seating_id === seating.seating_id);
  const primary = party.find((x) => x.table_id === x.primary_table_id) ?? party[0] ?? null;
  const joined = party.filter((x) => x.table_id !== x.primary_table_id);
  const free = freeTilesByFloor(body).flatMap((g) => g.tiles);
  const toJoined = to !== null && joined.some((x) => x.table_id === to.table_id);

  async function pickTarget(x: MapTile): Promise<void> {
    setTo(x);
    setTicked(new Set());
    setJustFree(false);
    const answer = await orders.seatingOrders(seating.seating_id);
    if (answer.ok) setLive(answer.data.orders.filter((o) => !o.cancelled).sort((a, b) => a.placed_at - b.placed_at));
    else onFailed(answer.error);
  }

  const toggle = (order_id: string) => {
    setJustFree(false);
    setTicked((cur) => {
      const next = new Set(cur);
      if (next.has(order_id)) next.delete(order_id);
      else next.add(order_id);
      return next;
    });
  };

  const count = live?.length ?? 0;
  const canSplit = to !== null && !busy && (justFree ? toJoined : ticked.size > 0 && ticked.size < count);

  async function split(): Promise<void> {
    if (!canSplit || to === null || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    const order_ids = justFree ? [] : (live ?? []).filter((o) => ticked.has(o.order_id)).map((o) => o.order_id);
    const answer = await tables.splitSeating({ from_table_id: seating.table_id, seating_id: seating.seating_id, to_table_id: to.table_id, order_ids });
    inflight.current = false;
    setBusy(false);
    if (answer.ok) onSplit({ to, moved: order_ids.length });
    else onFailed(answer.error);
  }

  const back = () => {
    setTo(null);
    setLive(null);
  };

  return (
    <DialogFrame code={code} title={fill(t('split.title'), { table: code })} sub={t('split.sub')} wide onClose={onClose}>
      {to === null ? (
        <>
          <div className="stepn">
            <span className="sdot">1</span>
            {t('split.step_target')}
          </div>
          <div className="mts">
            {[...joined, ...free].map((x) => (
              <MiniTile key={x.table_id} tile={x} me={me?.staff_id ?? null} pressed={false} onPick={() => void pickTarget(x)} />
            ))}
          </div>
          <div className="acts">
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="stepn">
            <span className="sdot sdot--ok">
              <Ico name="check" />
            </span>
            {t('split.step_target')} · <span className="num">{to.name}</span>
            {toJoined && <span> {t('split.joined')}</span>}
          </div>
          <div className="stepn">
            <span className="sdot">2</span>
            {fill(t('split.step_orders'), { table: to.name })}
          </div>
          {live === null ? (
            <p className="dlg__line">{t('common.loading')}</p>
          ) : (
            <div className="pick">
              {live.map((o, i) => (
                <button key={o.order_id} type="button" className="ckr" role="checkbox" aria-checked={ticked.has(o.order_id)} onClick={() => toggle(o.order_id)}>
                  <span className="chk">
                    <Ico name="check" />
                  </span>
                  <span>
                    <b>{fill(t('split.round'), { n: String(i + 1) })}</b>
                    <small>
                      <span className="num">{timeText(o.placed_at, clock.utcOffsetMs)}</span> · {o.placed_by.name ?? ''} · {fill(t('split.items'), { n: String(itemCount(o)) })}
                    </small>
                  </span>
                  <span className="amt num" dir="ltr">
                    {money(orderTotal(o))}
                  </span>
                </button>
              ))}
            </div>
          )}
          {toJoined && (
            <button
              type="button"
              className="ckr"
              role="checkbox"
              aria-checked={justFree}
              onClick={() => {
                setJustFree((v) => !v);
                setTicked(new Set());
              }}
            >
              <span className="chk">
                <Ico name="check" />
              </span>
              <span>
                <b>{fill(t('split.just_free'), { table: to.name })}</b>
              </span>
              <span />
            </button>
          )}
          {ticked.size > 0 && (
            <div className="sumline">{fill(t('split.summary'), { n: String(ticked.size), to: to.name, m: String(count - ticked.size), from: primary?.name ?? code })}</div>
          )}
          <div className="acts">
            <button type="button" className="btn" onClick={back}>
              {t('tables.back')}
            </button>
            <button type="button" className="btn btn--primary" disabled={!canSplit} onClick={() => void split()}>
              {t('split.go')}
            </button>
          </div>
        </>
      )}
    </DialogFrame>
  );
}
