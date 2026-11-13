import { useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { HubError } from '../../../../api/hub-admin';
import { t, type MessageKey } from '../../../../i18n';
import { Ico } from '../../../alerts/ui';
import { useShell, type Shell } from '../../shell/hooks';
import type { EnqueueMeta, EnqueueResult } from '../../tables/contracts';
import { tableErrorKey } from '../../tables/errors';
import { CompSheet } from '../actions/CompSheet';
import { MarkServedSheet, type ServedCandidate } from '../actions/MarkServedSheet';
import { pendingCompsOf } from '../actions/pending-comps';
import { RemoveSheet } from '../actions/RemoveSheet';
import { SendBackSheet } from '../actions/SendBackSheet';
import { WeightSheet } from '../actions/WeightSheet';
import type { OrderType, SeatingLine } from '../contracts';
import { atStageOne, isReady, isServed, isWeightPending, lineStage, servable } from './stage';

// 02b v1.0.11 §8 Table view: the actions of the selected line, from the session's permissions (R5) and the line's
// stage — Mark served (fired lines, §3.7), Remove (stage 1, §3.5), "Void…" disabled until module 04 (Q-24), Enter
// weight (§3.6), Send back (§3.8, E-7), Comp (§3.9; its waiting card is CompWaiting). Shared by the order view (27a1) and the table view's orders part (27a3). The sheet helper, the
// error toasts and the Enqueue answer handling live here too, so every line action shows them the same way.

/** One order as the line actions need it. */
export interface LineOrder {
  order_id: string;
  order_type: OrderType;
  /** what the sheets show in their code box ("57", "LEB 1234", "F4 + F5") */
  ident: string;
  billed: boolean;
  lines: SeatingLine[];
  /** dine-in: every command sends the shown seating (02a rule) */
  seating_id?: string;
  table_id?: string;
}

export interface LineActionsProps {
  line: SeatingLine;
  order: LineOrder;
  /** Mark served offers every servable line of the view (the table view: all its orders); default the order's */
  servedCandidates?: ServedCandidate[];
  /** RemoveItems on a dine-in order needs the lock (02a requireLock): the container says if this person may */
  canTakeOrder?: boolean;
  /** the view reads its orders again */
  onChanged(): void;
  /** E-7 "Send it as a new item" (dine-in; 27a3 binds 26d's startCompItCart); absent → not offered */
  onSendAsNew?: (line: SeatingLine) => void;
}

// ------------------------------------------------------------------------------------------- shared helpers

const ORDER_ERRORS: Record<string, MessageKey> = {
  ITEM_WRONG_STAGE: 'line.err.stage',
  ORDER_BILLED: 'line.err.billed',
  LINE_ALREADY_SETTLED: 'line.err.settled',
  ORDER_NOT_IN_ENGINE: 'return.closed',
  ORDER_NOT_FOUND: 'line.err.gone',
  LINE_NOT_WEIGHED: 'line.err.not_weighed',
};

/** The toast key of an 02b line command's error; table / permission codes as 02a's (§9). */
export function orderErrorKey(error: HubError): MessageKey {
  if (error.kind === 'api' && Object.hasOwn(ORDER_ERRORS, error.code)) return ORDER_ERRORS[error.code]!;
  return tableErrorKey(error);
}

/** Toast the error; a hub answer means the view is stale → read again (TABLE_SEATING_CHANGED: + one table-map read). */
export function showOrderError(shell: Shell, error: HubError, onChanged: () => void): void {
  shell.toasts.show({ text: t(orderErrorKey(error)), tone: 'warn' });
  if (error.kind !== 'api') return;
  if (error.code === 'TABLE_SEATING_CHANGED') void shell.tables.tableMap();
  onChanged();
}

/** Q-3: what a queueable send answered (sent only after a 2xx; queued offline; needs_hub with no queue). */
export function showEnqueued(shell: Shell, result: EnqueueResult, sentKey: MessageKey, onChanged: () => void): boolean {
  switch (result.status) {
    case 'sent':
      // the caller's onDone reads the view again (one read per action)
      shell.toasts.show({ text: t(sentKey) });
      return true;
    case 'queued':
      shell.toasts.show(result.logged === true ? { text: t('queue.in_log'), tone: 'warn' } : { text: t('tables.toast.queued'), tone: 'info' });
      return true;
    case 'needs_hub':
      shell.toasts.show({ text: t('tables.toast.needs_hub'), tone: 'warn' });
      return false;
    case 'refused':
      showOrderError(shell, result.error, onChanged);
      return false;
  }
}

export function enqueueMeta(order: Pick<LineOrder, 'seating_id' | 'table_id'>, label: string): EnqueueMeta {
  return { label, ...(order.table_id === undefined ? {} : { table_id: order.table_id }), ...(order.seating_id === undefined ? {} : { seating_id: order.seating_id }) };
}

export interface SheetProps {
  title: string;
  sub?: string | undefined;
  /** the code box (token, plate, table) */
  ident?: string | undefined;
  wide?: boolean;
  onClose(): void;
  children: ReactNode;
  actions: ReactNode;
}

/** A dialog over the view (`.scrim > .dlg`); a bottom sheet on a phone or a portrait tablet. */
export function Sheet({ title, sub, ident, wide = false, onClose, children, actions }: SheetProps) {
  const shell = useShell();
  const id = useId();
  return (
    <div className={shell.phone || shell.portrait ? 'scrim scrim--sheet' : 'scrim'}>
      <div className={wide ? 'dlg dlg--w' : 'dlg'} role="dialog" aria-modal="true" aria-labelledby={id}>
        <div className="dlg__h">
          {ident !== undefined && (
            <span className={ident.includes('+') ? 'tcode j' : 'tcode'} dir="ltr">
              {ident}
            </span>
          )}
          <div className="dlg__t">
            <h2 id={id}>{title}</h2>
            {sub !== undefined && <div className="ac__who">{sub}</div>}
          </div>
          <button type="button" className="btn btn--icon dlg__x" aria-label={t('common.close')} onClick={onClose}>
            <Ico name="x" />
          </button>
        </div>
        {children}
        <div className="acts">{actions}</div>
      </div>
    </div>
  );
}

/** The servable lines of an order, ready ones pre-ticked (frame MarkServed). */
export function servedCandidatesOf(lines: readonly SeatingLine[]): ServedCandidate[] {
  return lines.filter(servable).map((line) => ({ line, stage: lineStage(line), ready: isReady(line) }));
}

// ---------------------------------------------------------------------------------------------- the actions

type Open = 'served' | 'remove' | 'weight' | 'send_back' | 'comp' | null;

/** §3.9: a zone-served line is not comped while its zone undo is still open (COMP_NOT_ALLOWED). */
export function inZoneUndo(line: SeatingLine, zoneUndoMs: number | null, nowMs: number): boolean {
  if (!line.zone_served) return false;
  // the hub's check: now − added_at <= zone_undo_ms is still inside the window
  return zoneUndoMs === null || nowMs - line.added_at <= zoneUndoMs;
}

/** §3.9 Comp is offered: the grant (allowed or requires_approval), online, a free unit, no open request on the line. */
export function compOffered(shell: Shell, line: SeatingLine, order: Pick<LineOrder, 'billed'>): boolean {
  const grant = shell.permissions.resolution('apply-comp').grant;
  return (
    (grant === 'allowed' || grant === 'requires_approval') &&
    shell.online &&
    line.live_units - line.comped_units > 0 &&
    (line.line_kind === 'item' || line.line_kind === 'deal') &&
    line.return_of === null &&
    !isWeightPending(line) &&
    !order.billed &&
    pendingCompsOf(shell).forLine(line) === null &&
    !inZoneUndo(line, shell.config.config()?.zone_undo_ms ?? null, shell.clock.nowMs())
  );
}

export function LineActions({ line, order, servedCandidates, canTakeOrder, onChanged, onSendAsNew }: LineActionsProps) {
  const shell = useShell();
  const comps = pendingCompsOf(shell);
  // an open request closing (answered, withdrawn) brings Comp back
  useSyncExternalStore(comps.subscribe, comps.version);
  const [open, setOpen] = useState<Open>(null);
  const may = (p: Parameters<Shell['permissions']['allowed']>[0]) => shell.permissions.allowed(p);
  const takeOrder = canTakeOrder ?? may('take-order');
  const live = line.live_units > 0;
  const stageOne = atStageOne(line, order.lines);
  // §3.6: only a requires_weighing item (01c V18); a pending weight is one, else the branch config says so
  const requiresWeighing = line.quantity === null || (shell.config.snapshot()?.items.find((i) => i.item_id === line.item_id)?.requires_weighing ?? false);
  const weighable =
    line.line_kind === 'item' &&
    line.sale_unit !== 'piece' &&
    requiresWeighing &&
    line.return_of === null &&
    live &&
    line.comped_units + line.removed_units + line.voided_units === 0 &&
    !order.billed;
  // void-item is module 04's; until it is built the button stays disabled (Q-24)
  const voidResolution = shell.permissions.resolution('void-item').grant;
  const showVoid = live && !stageOne && line.line_kind !== 'option_child' && (voidResolution === 'allowed' || voidResolution === 'requires_approval');
  // §3.8 Return: a whole served line, not zone-served, not already remade (then the replacement has it)
  const replacement = order.lines.find((l) => l.return_of === line.order_item_id) ?? null;
  const returned = line.returned_units > 0 || line.stage === 'returned';
  // a Fix leaves a replacement line open until it is served (RETURN_ALREADY_OPEN): no second Send back meanwhile
  const openReturn = order.lines.some((l) => l.return_of === line.order_item_id && l.live_units > 0 && !isServed(l));
  const canReturn =
    may('mark-item-returned') && shell.online && live && isServed(line) && !line.zone_served && !returned && !openReturn && (line.line_kind === 'item' || line.line_kind === 'deal_part');
  // the replacement was removed or voided: the dish is ordered again as a new round (E-7, "Comp it?")
  const againAsNew = onSendAsNew !== undefined && may('take-order') && returned && replacement !== null && replacement.live_units === 0;
  const canComp = compOffered(shell, line, order);
  const close = () => setOpen(null);
  const done = () => {
    setOpen(null);
    onChanged();
  };

  return (
    <>
      {may('mark-served') && servable(line) && (
        <button type="button" className="btn btn--tone c-ok" onClick={() => setOpen('served')}>
          <Ico name="check" />
          {t('served.title')}
        </button>
      )}
      {takeOrder && stageOne && line.line_kind !== 'option_child' && !order.billed && (
        <button type="button" className="btn" onClick={() => setOpen('remove')}>
          <Ico name="x" />
          {t('line.remove')}
        </button>
      )}
      {showVoid && (
        <button type="button" className="btn btn--quiet" disabled aria-disabled="true" title={t('line.void_later')}>
          {t('line.void')}
          <small>{t('line.void_later')}</small>
        </button>
      )}
      {canReturn && (
        <button type="button" className="btn" onClick={() => setOpen('send_back')}>
          <Ico name="undo" />
          {t('line.send_back')}
        </button>
      )}
      {againAsNew && (
        <button type="button" className="btn" onClick={() => onSendAsNew(line)}>
          <Ico name="repeat" />
          {t('return.new_item')}
        </button>
      )}
      {canComp && (
        <button type="button" className="btn" onClick={() => setOpen('comp')}>
          <Ico name="checkc" />
          {t('comp.do')}
        </button>
      )}
      {may('set-line-weight') && weighable && (
        <button type="button" className="btn" onClick={() => setOpen('weight')}>
          <Ico name="clock" />
          {t('line.weight')}
        </button>
      )}
      {open === 'served' && (
        <MarkServedSheet
          ident={order.ident}
          candidates={servedCandidates ?? servedCandidatesOf(order.lines)}
          meta={(label) => enqueueMeta(order, label)}
          onClose={close}
          onDone={done}
          onChanged={onChanged}
        />
      )}
      {open === 'remove' && <RemoveSheet order={order} from={line.order_item_id} onClose={close} onDone={done} onChanged={onChanged} />}
      {open === 'send_back' && (
        <SendBackSheet line={line} order={order} {...(onSendAsNew === undefined ? {} : { onSendAsNew })} onClose={close} onDone={done} onChanged={onChanged} />
      )}
      {open === 'comp' && <CompSheet line={line} order={order} onClose={close} onDone={done} onChanged={onChanged} />}
      {open === 'weight' && <WeightSheet line={line} ident={order.ident} onClose={close} onDone={done} onChanged={onChanged} />}
    </>
  );
}
