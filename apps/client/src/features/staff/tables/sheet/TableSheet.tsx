import { useCallback, useEffect, useRef, useState } from 'react';
import { t, type MessageKey } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { HubError } from '../../../../api/hub-admin';
import { navigate } from '../../../../app/router';
import { Ico, type IconName } from '../../../alerts/ui';
import { timeText } from '../../../alerts/labels';
import { OrdersPart } from '../../orders/table-view/OrdersPart';
import { useShell, type Shell } from '../../shell/hooks';
import { orderHref } from '../../shell/routes';
import type { MapTile, OpenTablePayload, SeatingRef, TableMapBody } from '../contracts';
import { ForceMove } from '../dialogs/ForceMove';
import { ForceRelease } from '../dialogs/ForceRelease';
import { HandOver } from '../dialogs/HandOver';
import { Join } from '../dialogs/Join';
import { Move } from '../dialogs/Move';
import { MoveOtherOwner, otherOwnerOf, type OtherOwner } from '../dialogs/MoveOtherOwner';
import { Split } from '../dialogs/Split';
import { TableBusy, TableBusyOwn } from '../dialogs/TableBusy';
import { TakeOver } from '../dialogs/TakeOver';
import { tableErrorKey } from '../errors';
import { STATE_WORD, sheetModel, stateKey, type ActionId, type SheetAction } from './actions';

// 02a §8 Open, Table sheet, Offline, Rules (02-S06 TableSheet*): one table's actions for the seating it shows,
// over the dimmed map (a side panel; a bottom sheet on portrait / phone). Every command sends the shown
// `seating_id` (the tile's, else the one the tap carried); `409 TABLE_SEATING_CHANGED` → "This table changed —
// refreshed" + one `table-map` read. The orders part is 02b's `OrdersPart` (27a3).
// The sheet keeps its own copy of the map: the catch-up `tables` part, one `table-map` read on mount, and one
// debounced read on a table / order frame (the Q-5 set, Q-35 exclusions), a reconnect or the page turning visible.

export interface TableSheetProps {
  table_id: string;
  /** the tile's seating_id (from #/tables/<id>?seating_id=), null for a free table */
  seating_id: string | null;
}

/** 02a §6.19 table frames (tables/audiences.ts) except TableLockTouched; 02b order frames; BillClosed (Q-5, Q-35). */
const REFRESH_ON: ReadonlySet<string> = new Set([
  'TableOpened',
  'TableLocked',
  'TableLockReleased',
  'TableHolderChanged',
  'TableMoved',
  'TablesMerged',
  'SeatingSplit',
  'BillRequested',
  'TableCleaned',
  'OrderPlaced',
  'ItemAdded',
  'OrderLinesAdded',
  'ItemRemoved',
  'ItemVoided',
  'ItemServed',
  'ItemReturned',
  'ItemsReleased',
  'OrderBoosted',
  'OrderCancelled',
  'OrderFoodServed',
  'OrderFoodCleared',
  'OrdersBilled',
  'LineWeightSet',
  'LineComped',
  'OrderContactSet',
  'BillClosed',
]);
const DEBOUNCE_MS = 250;

const ICON: Partial<Record<ActionId, IconName>> = {
  bill: 'receipt',
  call: 'hand',
  hand: 'user',
  more: 'down',
  force_move: 'userlock',
  release_other: 'lock',
  release_mine: 'lock',
  move: 'repeat',
  join: 'team',
  split: 'esc',
  clean: 'checkc',
};

function isMapBody(v: unknown): v is TableMapBody {
  return typeof v === 'object' && v !== null && typeof (v as TableMapBody).as_of_seq === 'number' && Array.isArray((v as TableMapBody).floors);
}

const tilesOf = (body: TableMapBody | null): MapTile[] => body?.floors.flatMap((f) => f.zones.flatMap((z) => z.tables)) ?? [];

/** The sheet's map: never replaced by an older body (as_of_seq), only the newest read answers. */
function useSheetMap(shell: Shell): { body: TableMapBody | null; read: boolean; refresh: () => Promise<void> } {
  const { live, tables } = shell;
  const [body, setBody] = useState<TableMapBody | null>(() => {
    const part = live.part('tables');
    return isMapBody(part) ? part : null;
  });
  const generation = useRef(0);
  /** the sheet's own first read has answered (the tap's seating is checked against it) */
  const [read, setRead] = useState(false);
  const apply = useCallback((next: TableMapBody) => setBody((cur) => (cur !== null && next.as_of_seq < cur.as_of_seq ? cur : next)), []);
  const refresh = useCallback(async () => {
    const gen = ++generation.current;
    const answer = await tables.tableMap();
    if (gen === generation.current && answer.ok) {
      apply(answer.data);
      setRead(true);
    }
  }, [tables, apply]);
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const later = () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void refresh();
      }, DEBOUNCE_MS);
    };
    const off = live.subscribe((msg) => {
      if (msg.kind === 'catch_up') {
        const part = (msg.state as Record<string, unknown>)['tables'];
        if (isMapBody(part)) apply(part);
      } else if (msg.kind === 'event') {
        if (REFRESH_ON.has(msg.event.event_type)) later();
      } else later();
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, [live, refresh, apply]);
  return { body, read, refresh };
}

/** Every dialog keeps the seating it showed when it opened (T18): a change answers 409 on the hub. */
type Dialog =
  /** the seating the busy dialog opened on: the tile's on the tap path, the one the 409'd OpenTable sent; null = unknown */
  | { kind: 'busy'; name: string; seating: SeatingRef | null }
  | { kind: 'own' }
  | { kind: 'release'; name: string; seating: SeatingRef }
  | { kind: 'takeover'; name: string; seating: SeatingRef }
  | { kind: 'hand'; preset: string | null; seating: SeatingRef }
  | { kind: 'force_move' | 'move' | 'join' | 'split'; seating: SeatingRef }
  | { kind: 'owner'; owner: OtherOwner; seating: SeatingRef }
  | null;

export function TableSheet({ table_id, seating_id }: TableSheetProps) {
  const shell = useShell();
  const { tables, toasts, permissions, me, online, clock, phone, portrait } = shell;
  const { body, read, refresh } = useSheetMap(shell);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** one command at a time: a ref, so two taps before the re-render cannot both send */
  const inflight = useRef(false);
  const warned = useRef(false);

  const close = () => navigate('/tables');
  const all = tilesOf(body);
  const tile = all.find((x) => x.table_id === table_id) ?? null;
  const scrim = phone || portrait ? 'scrim scrim--sheet' : 'scrim scrim--side';
  const shownSeating = tile?.seating_id ?? null;
  // T18: the tap carried the tile's seating; once the sheet's own read shows another one, say so (the sheet then
  // acts on what it shows, never on the tap's old seating)
  useEffect(() => {
    if (!read || tile === null || warned.current || seating_id === null || shownSeating === seating_id) return;
    warned.current = true;
    toasts.show({ text: t('tables.changed'), tone: 'info' });
  }, [read, tile, shownSeating, seating_id, toasts]);

  if (tile === null) {
    return (
      <div className={scrim}>
        <section className="tv" role="dialog" aria-modal="true" aria-label={t('common.loading')}>
          <div className="tv__h">
            <p className="dlg__line">{t('common.loading')}</p>
          </div>
        </section>
      </div>
    );
  }

  const model = sheetModel(tile, me?.staff_id ?? null, permissions, online);
  const code = tile.joined_table_names.length > 1 ? tile.joined_table_names.join(' + ') : tile.name;
  /** the seating this sheet shows (T18): always the drawn tile's (null = free → OpenTable opens a new one) */
  const seat = tile.seating_id;
  const holderName = tile.holder?.name ?? '';
  const ref: SeatingRef | null = seat === null ? null : { table_id, seating_id: seat };
  const seatingTiles = tile.seating_id === null ? [tile] : all.filter((x) => x.seating_id === tile.seating_id);
  const seats = seatingTiles.reduce((n, x) => n + (x.seats ?? 0), 0);
  const word = STATE_WORD[tile.state];

  const toast = (key: MessageKey, tone: 'ok' | 'info' | 'warn' = 'warn') => toasts.show({ text: fill(t(key), { name: '', table: code }), tone });

  /** `sent`: the seating the refused command sent or the dialog showed (null = none) */
  function failed(error: HubError, sent: SeatingRef | null = null): void {
    if (error.kind === 'api' && error.code === 'TABLE_SEATING_CHANGED') {
      toast('tables.changed', 'info');
      void refresh();
      return;
    }
    if (error.kind === 'api' && error.code === 'TABLE_ALREADY_LOCKED') {
      const name = error.details['locked_by_name'];
      setDialog({ kind: 'busy', name: typeof name === 'string' ? name : (model.lockedBy?.name ?? ''), seating: sent });
      void refresh();
      return;
    }
    if (error.kind === 'api' && error.code === 'PERMISSION_DENIED' && error.details['reason'] === 'other_owner') {
      // 02a-D25 (Q-25): Move / Join / Split onto someone else's table or party
      const shown = sent ?? ref;
      if (shown !== null) setDialog({ kind: 'owner', seating: shown, owner: otherOwnerOf(error.details, me?.staff_id ?? null, nameOf, (id) => all.find((x) => x.table_id === id)?.name ?? id) });
      return;
    }
    toast(tableErrorKey(error));
  }

  /** a staff name from the map (holder, assignee or lock of any tile) */
  function nameOf(staff_id: string): string {
    for (const x of all) for (const p of [x.holder, x.assignee, x.lock]) if (p !== null && p.staff_id === staff_id && p.name !== null) return p.name;
    return '';
  }

  /** a dialog's command was refused: close it, then the usual handling */
  const refused = (error: HubError) => {
    const shown = dialog !== null && 'seating' in dialog ? dialog.seating : null;
    setDialog(null);
    failed(error, shown);
  };
  const done = () => {
    setDialog(null);
    void refresh();
  };

  async function run<T>(send: () => Promise<{ ok: true; data: T } | { ok: false; error: HubError }>, sent: SeatingRef | null = null): Promise<T | null> {
    if (inflight.current) return null;
    inflight.current = true;
    setBusy(true);
    const answer = await send();
    inflight.current = false;
    setBusy(false);
    if (answer.ok) return answer.data;
    setDialog(null);
    failed(answer.error, sent);
    return null;
  }

  async function openHere(shown: string | null = seat): Promise<void> {
    const payload: OpenTablePayload = shown === null ? { table_id } : { table_id, seating_id: shown };
    const opened = await run(() => tables.openTable(payload), shown === null ? null : { table_id, seating_id: shown });
    if (opened !== null) navigate(orderHref('dine_in', opened.seating_id));
  }

  /** TakeOverTable for the seating the dialog showed, then OpenTable for it; the sheet re-reads at once so a failed
   * open still shows the table as mine (a retry answers `changed: false`). */
  async function takeOver(shown: SeatingRef): Promise<void> {
    const changed = await run(() => tables.takeOverTable(shown));
    if (changed === null) return;
    setDialog(null);
    void refresh();
    await openHere(shown.seating_id);
  }

  /** Force release opens only on a known seating (a 409 on a tile drawn free: read the map first). */
  function openRelease(name: string, seating: SeatingRef | null): void {
    if (seating === null) {
      setDialog(null);
      toast('tables.changed', 'info');
      void refresh();
      return;
    }
    setDialog({ kind: 'release', name, seating });
  }

  async function releaseMine(): Promise<void> {
    if (ref === null) return;
    const done = await run(() => tables.releaseTableLock(ref));
    if (done === null) return;
    setMoreOpen(false);
    void refresh();
  }

  function tap(a: SheetAction): void {
    if (a.off !== null) {
      toast(a.off);
      return;
    }
    if (a.busy === true && model.lockedBy !== null) {
      setDialog({ kind: 'busy', name: model.lockedBy.name, seating: ref });
      return;
    }
    switch (a.id) {
      case 'take_order':
      case 'add_items':
        if (model.ownElsewhere) setDialog({ kind: 'own' });
        else void openHere();
        return;
      case 'take_over':
        if (ref !== null) setDialog({ kind: 'takeover', name: holderName, seating: ref });
        return;
      case 'release_other':
        openRelease(model.lockedBy?.name ?? '', ref);
        return;
      case 'release_mine':
        void releaseMine();
        return;
      case 'more':
        setMoreOpen((v) => !v);
        return;
      case 'hand':
      case 'force_move':
      case 'move':
      case 'join':
      case 'split':
        setMoreOpen(false);
        if (ref !== null) setDialog(a.id === 'hand' ? { kind: 'hand', preset: null, seating: ref } : { kind: a.id, seating: ref });
        return;
      default:
        // ask for bill, call waiter, clean (22c)
        return;
    }
  }

  const label = (a: SheetAction): string => {
    switch (a.id) {
      case 'take_order':
        return a.busy === true && model.lockedBy !== null ? fill(t('sheet.take_order_busy'), { name: model.lockedBy.name }) : t('sheet.take_order');
      case 'add_items':
        return a.busy === true && model.lockedBy !== null
          ? fill(t('sheet.take_order_busy'), { name: model.lockedBy.name })
          : fill(t('sheet.add_items_round'), { n: String(tile.live_order_count + 1) });
      case 'take_over':
        return fill(t('sheet.take_over_from'), { name: tile.holder?.name ?? '' });
      case 'mark_clean':
        return t('sheet.mark_clean');
      case 'bill':
        return t('sheet.act.bill');
      case 'call':
        return t('sheet.act.call');
      case 'hand':
        return t('sheet.act.hand');
      case 'more':
        return t('sheet.act.more');
      case 'force_move':
        return t('sheet.act.force_move');
      case 'release_other':
        return fill(t('sheet.act.release_other'), { name: model.lockedBy?.name ?? '' });
      case 'release_mine':
        return t('sheet.act.release_mine');
      case 'move':
        return t('sheet.act.move');
      case 'join':
        return t('sheet.act.join');
      case 'split':
        return t('sheet.act.split');
      case 'clean':
        return t('sheet.mark_clean');
    }
  };

  const sub = (a: SheetAction): string | null => {
    if (a.id === 'move' && a.off === 'sheet.split_first') return fill(t('sheet.split_first'), { table: code });
    if (a.id === 'join') return t('sheet.join_sub');
    if (a.id === 'split') {
      // the joined tables after the primary (§3.12 detach frees a joined table, never the primary)
      const rest = seatingTiles.filter((x) => x.table_id !== tile.primary_table_id).map((x) => x.name);
      return rest.length > 0 ? fill(t('sheet.split_sub'), { table: rest.join(' + ') }) : t('sheet.split_sub_one');
    }
    return null;
  };

  const actButton = (a: SheetAction) => {
    const off = a.off !== null;
    const danger = a.id === 'release_other';
    return (
      <button
        key={a.id}
        type="button"
        className={`btn btn--act${danger ? ' btn--tone c-danger' : ''}${off ? ' off' : ''}`}
        aria-disabled={off ? 'true' : undefined}
        aria-expanded={a.id === 'more' ? moreOpen : undefined}
        onClick={() => tap(a)}
      >
        <Ico name={ICON[a.id] ?? 'chev'} />
        {label(a)}
        {off && a.needsHub && model.offline && <Ico name="wifioff" />}
      </button>
    );
  };

  const primary = model.primary;
  const primaryOff = primary !== null && (primary.off !== null || primary.busy === true);
  const title =
    model.title.kind === 'mine'
      ? t('sheet.your_table')
      : model.title.kind === 'theirs'
        ? fill(t('sheet.their_table'), { name: model.title.name })
        : model.title.kind === 'clean'
          ? t('sheet.clean_title')
          : t('tables.state.free');
  const minutes = tile.opened_at === null ? null : Math.max(0, Math.floor((clock.nowMs() - tile.opened_at) / 60_000));

  return (
    <>
      <div className={scrim}>
        <section
          className="tv"
          role="dialog"
          aria-modal="true"
          aria-label={`${code} · ${title}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && dialog === null) close();
          }}
        >
          <div className="tv__h">
            <div className="tv__hd">
              <span className={`tcode${code.includes('+') ? ' j' : ''}`} dir="ltr">
                {code}
              </span>
              <div className="tv__t">
                <h2>{title}</h2>
                <div className="tv__m">
                  <span className={`st c-${word}`}>{t(stateKey(tile.state))}</span>
                  {minutes !== null && tile.opened_at !== null && (
                    <span className="i">
                      <Ico name="clock" />
                      <b className="num">{fill(t('sheet.open_for'), { n: String(minutes) })}</b>
                      {' · '}
                      <span className="num">{fill(t('sheet.since'), { time: timeText(tile.opened_at, clock.utcOffsetMs) })}</span>
                    </span>
                  )}
                  {(tile.party_size !== null || seats > 0) && (
                    <span className="i">
                      <Ico name="team" />
                      {tile.party_size !== null
                        ? fill(t('sheet.guests_seats'), { n: String(tile.party_size), m: String(seats) })
                        : fill(t('sheet.seats'), { m: String(seats) })}
                    </span>
                  )}
                  {tile.assignee !== null && tile.assignee.staff_id !== tile.holder?.staff_id && model.title.kind === 'theirs' && (
                    <span className="i">{fill(t('tables.zone.other'), { name: tile.assignee.name ?? '' })}</span>
                  )}
                  {model.lockedBy !== null && (
                    <span className="lk">
                      <Ico name="lock" />
                      {fill(t('sheet.ordering'), { name: model.lockedBy.name })}
                    </span>
                  )}
                </div>
              </div>
              <button type="button" className="btn btn--icon dlg__x" aria-label={t('common.close')} onClick={close}>
                <Ico name="x" />
              </button>
            </div>
            {model.offline && (
              <div className="msg c-warn" role="alert">
                <Ico name="wifioff" />
                <span>{t('sheet.offline')}</span>
              </div>
            )}
            {model.note !== null && (
              <div className="ro" role="status">
                <Ico name="info" />
                <span>{model.note === 'waiter' ? t('sheet.waiter_note') : fill(t('sheet.read_only_holder'), { name: tile.holder?.name ?? '' })}</span>
              </div>
            )}
            {primary !== null && (
              <div className="tv__main">
                <button
                  type="button"
                  className={`btn btn--primary btn--lg btn--block${primaryOff ? ' off' : ''}`}
                  aria-disabled={primaryOff ? 'true' : undefined}
                  onClick={() => tap(primary)}
                >
                  {label(primary)}
                  {primary.off !== null && primary.needsHub && model.offline && <Ico name="wifioff" />}
                </button>
              </div>
            )}
            {model.acts.length > 0 && <div className={`tv__acts${model.acts.length === 3 ? ' tv__acts--3' : ''}`}>{model.acts.map(actButton)}</div>}
            {moreOpen && model.more.length > 0 && (
              <div className="needs" role="group" aria-label={t('sheet.act.more')}>
                {model.more.map((a) => {
                  const s = sub(a);
                  const off = a.off !== null;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      className={`ny c-brand${off ? ' off' : ''}`}
                      aria-disabled={off ? 'true' : undefined}
                      onClick={() => tap(a)}
                    >
                      <span className="ny__c">
                        <Ico name={ICON[a.id] ?? 'chev'} />
                      </span>
                      <span>
                        <span className="ny__t">{label(a)}</span>
                        {s !== null && <span className="ny__s">{s}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {tile.seating_id !== null && tile.holder !== null && tile.primary_table_id !== null && (
            <div className="tv__b">
              <OrdersPart
                seating_id={tile.seating_id}
                table_ids={seatingTiles.map((x) => x.table_id)}
                primary_table_id={tile.primary_table_id}
                holder_staff_id={tile.holder.staff_id}
                mine={me !== null && tile.holder.staff_id === me.staff_id}
              />
            </div>
          )}
        </section>
      </div>
      {dialog?.kind === 'busy' && (
        <TableBusy
          code={code}
          name={dialog.name}
          canRelease={permissions.allowed('force-release-table-lock')}
          onClose={() => setDialog(null)}
          onRelease={() => openRelease(dialog.name, dialog.seating)}
        />
      )}
      {dialog?.kind === 'own' && <TableBusyOwn code={code} onClose={() => setDialog(null)} onOpenHere={() => void openHere()} />}
      {dialog?.kind === 'release' && (
        <ForceRelease
          code={code}
          name={dialog.name}
          seating={dialog.seating}
          onClose={() => setDialog(null)}
          onReleased={(released) => {
            setDialog(null);
            // §6.4 `released: false`: the lock was already gone; the re-read shows it
            if (released) toast('tables.toast.forced_released', 'ok');
            void refresh();
          }}
          onFailed={(error) => {
            setDialog(null);
            failed(error);
          }}
        />
      )}
      {dialog?.kind === 'hand' && (
        <HandOver
          code={code}
          seating={dialog.seating}
          preset={dialog.preset}
          onClose={() => setDialog(null)}
          onSent={(to) => {
            toasts.show({ text: fill(t('tables.toast.sent_to'), { name: to.name }), tone: 'ok' });
            done();
          }}
          onFailed={refused}
        />
      )}
      {dialog?.kind === 'force_move' && <ForceMove code={code} seating={dialog.seating} onClose={() => setDialog(null)} onMoved={done} onFailed={refused} />}
      {dialog?.kind === 'move' && (
        <Move
          code={code}
          seating={dialog.seating}
          body={body}
          onClose={() => setDialog(null)}
          onMoved={(to) => {
            toasts.show({ text: fill(t('tables.toast.moved'), { table: to.name }), tone: 'ok' });
            done();
          }}
          onFailed={refused}
        />
      )}
      {dialog?.kind === 'join' && <Join code={code} seating={dialog.seating} body={body} onClose={() => setDialog(null)} onJoined={done} onFailed={refused} />}
      {dialog?.kind === 'split' && (
        <Split
          code={code}
          seating={dialog.seating}
          body={body}
          onClose={() => setDialog(null)}
          onSplit={({ to, moved }) => {
            toasts.show({
              text: moved === 0 ? fill(t('tables.toast.free'), { table: to.name }) : fill(t('tables.toast.orders_moved'), { n: String(moved), table: to.name }),
              tone: 'ok',
            });
            done();
          }}
          onFailed={refused}
        />
      )}
      {dialog?.kind === 'owner' && (
        <MoveOtherOwner code={code} owner={dialog.owner} onClose={() => setDialog(null)} onHandOver={(staff_id) => setDialog({ kind: 'hand', preset: staff_id, seating: dialog.seating })} />
      )}
      {dialog?.kind === 'takeover' && (
        <TakeOver code={code} name={dialog.name} busy={busy} onClose={() => setDialog(null)} onConfirm={() => void takeOver(dialog.seating)} />
      )}
    </>
  );
}
