import { useEffect, useRef, useState } from 'react';
import { VOID_DISPOSITIONS, type VoidDisposition, type VoidReasonCode } from '@pos/domain';
import { newUlid } from '../../app/ulid';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import type { HubError } from '../../api/hub-admin';
import { Ico } from '../alerts/ui';
import { useShell } from '../staff/shell/hooks';
import { definitiveRefusal, tableErrorKey } from '../staff/tables/errors';
import type { RemoveItemsPayload, SeatingLine } from '../staff/orders/contracts';
import { MONEY_DIR, money } from '../staff/orders/money';
import type { LineOrder } from '../staff/orders/view/LineActions';
import { lineStage, stageText } from '../staff/orders/view/stage';
import { voidItems, voidPreview } from './api';
import type { VoidItemsPayload, VoidPreview } from './contracts';
import { voidErrorText } from './errors';
import { VIco } from './icons';
import { defaultDisposition, dispositionEnabled, listText, movedPartly, REASON_CHIPS, REASON_KEY, VOID_NOTE_MAX } from './model';
import { pendingVoidsOf } from './pending';
import { DISPOSITION_KEY, OffButton, VoidDialog, VoidMsg } from './ui';

// 04 v1.0.5 §8 Cancel order ("Void all") and Cancel table (frames CancelOrder, CancelOrderWasteAll,
// CancelOrderRemoveFailed, CancelOrderRetry; handoff decision 12; owner Q-VU1-1 (a), row S-1; §10 #59, #59b).
// - Order view: Cancel order, one order. Table view More: Cancel table, every live order (round) of the seating.
// - ONE void-preview per order with every live parent line; its `group` per line (V1 incl. d′) gives each round's
//   Remove and Void groups, never the line's own stage. A round with no line left is not shown.
// - One reason for the whole sheet; per-line default from each entry's own preview (moved when enabled, else wastage);
//   one sheet-level Waste all; each line still changeable.
// - Two passes: FIRST every round's RemoveItems (oldest first; never queued, V15), THEN every round's VoidItems
//   (oldest first, parents only). Not atomic across orders: a client sequence of the existing commands.
// - A failed RemoveItems stops: nothing is voided anywhere; every preview is read again; the sheet says which rounds
//   are already cancelled. A failed VoidItems keeps every removal and the earlier voids; the failed round and every
//   later one are read again; Try again continues from the failed round.
// - Each command has its own command_id (D32): a lost reply freezes the sheet and the retry resends that command as
//   it was; a retry after a reload builds new commands with new ids.

export interface CancelRound {
  /** the table view's round number (1 for the order view) */
  n: number;
  order: LineOrder;
}

export interface CancelOrderSheetProps {
  /** oldest first */
  rounds: readonly CancelRound[];
  /** order view: Cancel order; table view: Cancel table */
  mode: 'order' | 'table';
  onClose(): void;
  /** done: the view reads again */
  onDone(): void;
  onChanged(): void;
}

/** §8 "parents only": items and deals; an option child or deal part only when its parent is not live. */
export function cancelTargets(lines: readonly SeatingLine[]): SeatingLine[] {
  const live = new Set(lines.filter((l) => l.live_units > 0).map((l) => l.order_item_id));
  return lines.filter((l) => l.live_units > 0 && (l.parent_order_item_id === null || !live.has(l.parent_order_item_id)));
}

/** §6.1 / §6.3 / 02b §6.2: `lines` and `order_item_ids` are 1–40 a call; a longer round is read and sent in parts. */
export const CALL_MAX = 40;
const chunks = <T,>(xs: readonly T[]): T[][] => Array.from({ length: Math.ceil(xs.length / CALL_MAX) }, (_, k) => xs.slice(k * CALL_MAX, k * CALL_MAX + CALL_MAX));

type Note = { tone: 'ok' | 'danger'; text: string; hint?: string | undefined };
type Cmd =
  | { kind: 'remove'; order_id: string; last: boolean; commandId: string; payload: RemoveItemsPayload }
  | { kind: 'void'; order_id: string; last: boolean; commandId: string; payload: VoidItemsPayload };
type Outcome = 'ok' | 'lost' | HubError;

export function CancelOrderSheet({ rounds: given, mode, onClose, onDone, onChanged }: CancelOrderSheetProps) {
  const shell = useShell();
  const online = shell.online;
  // review #233: the rounds are frozen when the sheet opens (a frame dropping a cancelled order, or a round placed
  // meanwhile, never changes what this sheet shows or sends)
  const [rounds] = useState(() => given);
  /** each order's lines as this sheet knows them (removed lines leave) */
  const [lines, setLines] = useState<ReadonlyMap<string, readonly SeatingLine[]>>(() => new Map(rounds.map((r) => [r.order.order_id, r.order.lines])));
  /** each order's preview; absent = being read */
  const [previews, setPreviews] = useState<ReadonlyMap<string, VoidPreview[]>>(new Map());
  /** each order's last failed read (review #233 round 2: per order, so one failed read never hides another's rows) */
  const [loadErrors, setLoadErrors] = useState<ReadonlyMap<string, HubError>>(new Map());
  /** orders to read again (a counter per order) */
  const [reloads, setReloads] = useState<ReadonlyMap<string, number>>(new Map());
  const [picked, setPicked] = useState<ReadonlyMap<string, VoidDisposition>>(new Map());
  const [wasteAll, setWasteAll] = useState(false);
  const [reason, setReason] = useState<VoidReasonCode | null>(null);
  const [note, setNote] = useState('');
  /** V12: one disposition_note per command, for every line set to Other */
  const [dispositionNote, setDispositionNote] = useState('');
  const [busy, setBusy] = useState(false);
  /** a double tap in one batch never sends twice */
  const sending = useRef(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const doneRef = useRef(new Set<string>());
  /** rounds whose last command returned 200 */
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  /** a VoidItems failed: Try again continues from this round's number */
  const [retryFrom, setRetryFrom] = useState<number | null>(null);
  /** D32: a lost reply; the sheet is frozen and the plan goes on from that command, with its command_id */
  const lostPlan = useRef<{ cmds: Cmd[]; at: number } | null>(null);
  const [frozen, setFrozen] = useState(false);
  const tally = useRef({ removed: 0, voided: 0, asked: 0 });
  /** what this sheet removed, from the hub's answers ("Seekh Kebab ×4 removed", frame CancelOrderRetry) */
  const removedRef = useRef<Array<{ name: string; units: number }>>([]);

  const live = rounds.filter((r) => !done.has(r.order.order_id));
  const linesOf = (id: string) => lines.get(id) ?? [];

  // void-preview per live order (in parts of 40), again only when that order's reload counter or its lines move
  // (a chunk that changes lines starts an extra read; harmless: only the newest read of an order applies, readFor below)
  const keyOf = (id: string) => `${reloads.get(id) ?? 0}:${linesOf(id).map((l) => l.live_units).join('.')}`;
  const readKey = live.map((r) => `${r.order.order_id}=${keyOf(r.order.order_id)}`).join('|');
  /** the key each order's last read was for */
  const readFor = useRef(new Map<string, string>());
  useEffect(() => {
    if (!online) return;
    for (const r of live) {
      const id = r.order.order_id;
      const key = keyOf(id);
      if (readFor.current.get(id) === key) continue;
      readFor.current.set(id, key);
      const targets = cancelTargets(linesOf(id));
      if (targets.length === 0) {
        setPreviews((m) => new Map(m).set(id, []));
        continue;
      }
      void Promise.all(chunks(targets).map((part) => voidPreview(shell.api, { order_id: id, order_item_ids: part.map((l) => l.order_item_id) }))).then((answers) => {
        // only the newest read of this order answers
        if (readFor.current.get(id) !== key) return;
        const failed = answers.find((a) => !a.ok);
        if (failed !== undefined && !failed.ok) {
          const error = failed.error;
          setLoadErrors((m) => new Map(m).set(id, error));
          return;
        }
        setLoadErrors((m) => {
          if (!m.has(id)) return m;
          const next = new Map(m);
          next.delete(id);
          return next;
        });
        setPreviews((m) => new Map(m).set(id, answers.flatMap((a) => (a.ok ? a.data.previews : []))));
      });
    }
    // readKey names every live order with its reload counter and its lines
  }, [online, shell.api, readKey]);

  const reread = (ids: readonly string[]) => {
    setLoadErrors((m) => {
      const next = new Map(m);
      for (const id of ids) next.delete(id);
      return next;
    });
    setPreviews((m) => {
      const next = new Map(m);
      for (const id of ids) next.delete(id);
      return next;
    });
    setReloads((m) => {
      const next = new Map(m);
      for (const id of ids) next.set(id, (next.get(id) ?? 0) + 1);
      return next;
    });
  };

  const view = live.map((r) => {
    const id = r.order.order_id;
    const ps = previews.get(id);
    const all = linesOf(id);
    const byId = new Map(all.map((l) => [l.order_item_id, l]));
    return {
      round: r,
      all,
      byId,
      ready: ps !== undefined,
      remove: (ps ?? []).filter((p) => p.group === 'remove'),
      void: (ps ?? []).filter((p) => p.group === 'void' && p.pending === null),
      locked: (ps ?? []).filter((p) => p.group === 'void' && p.pending !== null),
    };
  });
  const allReady = view.every((v) => v.ready);
  const allVoid = view.flatMap((v) => v.void);
  const approval = allVoid.some((p) => p.needs_approval) || (allVoid.length === 0 && shell.permissions.resolution('void-item').grant === 'requires_approval');
  const dispositionOf = (p: VoidPreview): VoidDisposition => {
    const own = picked.get(p.order_item_id);
    if (own !== undefined && dispositionEnabled(p, own)) return own;
    if (wasteAll) return 'wastage';
    return defaultDisposition(p);
  };
  /** a Remove row's amount: the line and the option children removed with it (frame CancelOrder) */
  const removeAmount = (p: VoidPreview, all: readonly SeatingLine[]) =>
    all.filter((l) => l.live_units > 0 && (l.order_item_id === p.order_item_id || l.parent_order_item_id === p.order_item_id)).reduce((s, l) => s + l.billed_minor, 0);
  const compWaiting = allVoid.some((p) => p.needs_approval && p.comp_pending !== null);
  const anyOther = allVoid.some((p) => dispositionOf(p) === 'other');
  const total = view.reduce((s, v) => s + v.remove.reduce((x, p) => x + removeAmount(p, v.all), 0) + v.void.reduce((x, p) => x + p.refund_minor, 0), 0);
  const n = view.reduce((s, v) => s + v.remove.length, 0);
  const m = allVoid.length;
  const reasonOk = reason !== null && (reason !== 'other' || note.trim() !== '');
  const dnoteOk = !anyOther || dispositionNote.trim() !== '';
  const canSend = online && (frozen || (allReady && n + m > 0 && reasonOk && dnoteOk && !compWaiting));

  const go = (): string => {
    if (retryFrom !== null) return fill(t('void_all.retry'), { m: String(m) });
    const parts: string[] = [];
    if (n > 0) parts.push(fill(t('void_all.go.remove'), { n: String(n) }));
    if (m > 0) parts.push(fill(t(n > 0 ? (approval ? 'void_all.go.ask' : 'void_all.go.void') : approval ? 'void_all.go.ask_first' : 'void_all.go.void_first'), { m: String(m) }));
    return parts.join(' · ');
  };
  const label =
    !online || !allReady || frozen ? go() : compWaiting ? t('void.comp_waiting') : reason === null ? t('comp.pick_reason') : !reasonOk || !dnoteOk ? t('void.write_why_first') : go();
  const roundsDone = (): Note[] => rounds.filter((r) => doneRef.current.has(r.order.order_id)).map((r) => ({ tone: 'ok', text: fill(t('void_table.round_done'), { n: String(r.n) }) }));
  const markDone = (id: string) => {
    doneRef.current.add(id);
    setDone(new Set(doneRef.current));
  };

  /** the plan: every round's RemoveItems (oldest first), then every round's VoidItems (oldest first); 40 lines a call */
  const plan = (): Cmd[] => {
    const cmds: Cmd[] = [];
    if (retryFrom === null) {
      for (const v of view) {
        const parts = chunks(v.remove);
        parts.forEach((part, k) =>
          cmds.push({
            kind: 'remove',
            order_id: v.round.order.order_id,
            last: k === parts.length - 1 && v.void.length === 0,
            commandId: newUlid(),
            payload: {
              order_id: v.round.order.order_id,
              ...(v.round.order.seating_id === undefined ? {} : { seating_id: v.round.order.seating_id }),
              // no units: all live units (02b §6.2)
              lines: part.map((p) => ({ order_item_id: p.order_item_id })),
            },
          }),
        );
      }
    }
    for (const v of view) {
      if (retryFrom !== null && v.round.n < retryFrom) continue;
      const parts = chunks(v.void);
      parts.forEach((part, k) => {
        const entries = part.map((p) => ({ order_item_id: p.order_item_id, disposition: dispositionOf(p) }));
        cmds.push({
          kind: 'void',
          order_id: v.round.order.order_id,
          last: k === parts.length - 1,
          commandId: newUlid(),
          payload: {
            order_id: v.round.order.order_id,
            reason_code: reason!,
            note: reason === 'other' ? note.trim().slice(0, VOID_NOTE_MAX) : null,
            disposition_note: entries.some((e) => e.disposition === 'other') ? dispositionNote.trim().slice(0, VOID_NOTE_MAX) : null,
            lines: entries,
          },
        });
      });
    }
    return cmds;
  };

  async function run(cmd: Cmd): Promise<Outcome> {
    if (cmd.kind === 'remove') {
      const answer = await shell.api.command<{ removed: Array<{ order_item_id: string; units: number }>; cancelled: boolean }>('RemoveItems', cmd.payload, { commandId: cmd.commandId });
      if (!answer.ok) return definitiveRefusal(answer.error) === null && answer.error.kind !== 'signed_out' ? 'lost' : answer.error;
      const known = new Map(linesOf(cmd.order_id).map((l) => [l.order_item_id, l.name]));
      tally.current.removed += answer.data.removed.length;
      removedRef.current.push(...answer.data.removed.map((r) => ({ name: known.get(r.order_item_id) ?? '', units: r.units })));
      const gone = new Set(cmd.payload.lines.map((l) => l.order_item_id));
      setLines((cur) => new Map(cur).set(cmd.order_id, (cur.get(cmd.order_id) ?? []).map((l) => (gone.has(l.order_item_id) || gone.has(l.parent_order_item_id ?? '') ? { ...l, live_units: 0 } : l))));
      if (answer.data.cancelled || cmd.last) markDone(cmd.order_id);
      return 'ok';
    }
    const answer = await voidItems(shell.api, cmd.payload, { commandId: cmd.commandId });
    if (!answer.ok) return definitiveRefusal(answer.error) === null && answer.error.kind !== 'signed_out' ? 'lost' : answer.error;
    if ('pending' in answer.data) {
      tally.current.asked += answer.data.pending.length;
      for (const p of answer.data.pending) pendingVoidsOf(shell).remember({ alert_id: p.alert_id, reason: cmd.payload.reason_code, disposition: cmd.payload.lines.find((l) => l.order_item_id === p.order_item_id)?.disposition ?? 'wastage' });
    } else {
      tally.current.voided += answer.data.voided.length;
      // review #233 round 2 (BLOCKER): a voided line leaves this sheet with the units the hub took, so a reload or a
      // retry after a later chunk fails never asks for or sends it again (the hub refuses 0 live units)
      const took = new Map<string, number>();
      for (const v of answer.data.voided) took.set(v.order_item_id, (took.get(v.order_item_id) ?? 0) + v.units);
      // this starts another read of the order; harmless, the newest-read guard (readFor) drops any older answer
      setLines((cur) => new Map(cur).set(cmd.order_id, (cur.get(cmd.order_id) ?? []).map((l) => (took.has(l.order_item_id) ? { ...l, live_units: Math.max(0, l.live_units - took.get(l.order_item_id)!) } : l))));
    }
    if (cmd.last) markDone(cmd.order_id);
    return 'ok';
  }

  const send = async () => {
    if (sending.current || !canSend) return;
    sending.current = true;
    setBusy(true);
    setNotes([]);
    const resumed = lostPlan.current;
    lostPlan.current = null;
    const cmds = resumed?.cmds ?? plan();
    for (let i = resumed?.at ?? 0; i < cmds.length; i += 1) {
      const cmd = cmds[i]!;
      const r = await run(cmd);
      if (r === 'ok') continue;
      sending.current = false;
      setBusy(false);
      if (r === 'lost') {
        lostPlan.current = { cmds, at: i };
        setFrozen(true);
        setNotes([...roundsDone(), { tone: 'danger', text: t('line.err.lost') }]);
        return;
      }
      refused(cmd.kind, cmd.order_id, r);
      return;
    }
    sending.current = false;
    setBusy(false);
    setFrozen(false);
    finish();
  };

  const refused = (kind: 'remove' | 'void', order_id: string, error: HubError) => {
    setFrozen(false);
    const at = Math.max(0, rounds.findIndex((r) => r.order.order_id === order_id));
    if (kind === 'remove') {
      // nothing is voided anywhere; every live order is read again
      setNotes([...roundsDone(), { tone: 'danger', text: fill(t('void_all.nothing_cancelled'), { error: t(tableErrorKey(error)) }), hint: t('void_all.reloaded') }]);
      if (error.kind === 'api' && error.code === 'TABLE_SEATING_CHANGED') void shell.tables.tableMap();
      setRetryFrom(null);
      reread(rounds.filter((r) => !doneRef.current.has(r.order.order_id)).map((r) => r.order.order_id));
    } else {
      // removals and earlier voids stay; the failed round and every later one are read again
      const removed: Note[] = removedRef.current.map((r) => ({ tone: 'ok', text: fill(t('void_all.removed'), { item: r.name, n: String(r.units) }) }));
      setNotes([...roundsDone(), ...removed, { tone: 'danger', text: fill(t('void_all.voids_not_sent'), { error: t(voidErrorText(error).key) }), hint: t('void_all.left_below') }]);
      setRetryFrom(rounds[at]!.n);
      reread(rounds.slice(at).filter((r) => !doneRef.current.has(r.order.order_id)).map((r) => r.order.order_id));
    }
    onChanged();
  };

  const finish = () => {
    const c = tally.current;
    if (mode === 'order') {
      shell.toasts.show({ text: t('void.toast.cancelled'), sub: fill(t(approval ? 'void.toast.cancelled.sub' : 'void.toast.cancelled.sub_direct'), { removed: String(c.removed), voids: String(c.voided + c.asked) }) });
    } else {
      shell.toasts.show({
        text: t(c.asked > 0 ? 'void_table.toast.asked' : 'void_table.toast.cancelled'),
        sub: fill(t('void_table.toast.sub'), { removed: String(c.removed), voided: String(c.voided), asked: String(c.asked) }),
      });
    }
    onDone();
  };

  const msgs = [
    ...(!online ? [<VoidMsg key="off" tone="danger" icon="wifioff" text={t('answer.error.offline')} hint={t('void.err.offline.hint')} />] : []),
    ...notes.map((x, i) => <VoidMsg key={`n${i}`} tone={x.tone} icon={x.tone === 'ok' ? 'check' : 'warn'} text={x.text} hint={x.hint} />),
  ];

  const stageChip = (line: SeatingLine | undefined) => {
    const st = line === undefined ? null : lineStage(line);
    return st === null ? null : (
      <span className={`stg c-${st.tone}`}>
        <Ico name={st.icon} />
        {stageText(st, shell.clock.utcOffsetMs)}
      </span>
    );
  };
  const nameRow = (p: VoidPreview, byId: ReadonlyMap<string, SeatingLine>) => {
    const line = byId.get(p.order_item_id);
    const children = p.touched.filter((x) => x.order_item_id !== p.order_item_id);
    const firstChild = line?.line_kind === 'deal' ? children.map((c) => byId.get(c.order_item_id)).find((c) => c !== undefined && lineStage(c)?.key !== 'stage.later') : undefined;
    return (
      <span>
        <b>
          {line?.name ?? p.order_item_id} <span className="num">×{line?.live_units ?? 1}</span>
        </b>
        <small>
          {stageChip(line?.line_kind === 'deal' ? firstChild : line)}
          {line?.line_kind === 'item' && children.length > 0 && fill(t('void_all.with_child'), { child: listText(children.map((c) => fill(t('void_all.child'), { name: c.name, n: String(c.units) }))) })}
          {p.needs_approval && p.comp_pending !== null && (
            <span className="bdg c-brand">
              <Ico name="clock" />
              {t('void.comp_waiting')}
            </span>
          )}
        </small>
      </span>
    );
  };

  const off = busy || !canSend;
  const firstVoid = view.find((v) => v.void.length > 0);
  const shown = view.filter((v) => !v.ready || v.remove.length + v.void.length + v.locked.length > 0);
  const sub = mode === 'order' ? t('void_all.sub_one') : fill(t('void_all.sub'), { rounds: listText(live.map((r) => fill(t('void_table.round'), { n: String(r.n) }))) });
  return (
    <VoidDialog variant="all" title={t(mode === 'order' ? 'void_all.title' : 'void_table.title')} sub={sub} ident={rounds[0]?.order.ident} onClose={onClose}>
      {msgs}
      <div className="vgrid">
        <div className="vcol">
          {shown.map((v) => (
            <div className="vround" key={v.round.order.order_id} data-round={v.round.n}>
              {mode === 'table' && <span className="vlab">{fill(t('void_table.round'), { n: String(v.round.n) })}</span>}
              {!v.ready && loadErrors.has(v.round.order.order_id) ? (
                <VoidMsg
                  tone="danger"
                  text={t(voidErrorText(loadErrors.get(v.round.order.order_id)!).key)}
                  action={
                    <button type="button" className="btn" data-retry={v.round.order.order_id} onClick={() => reread([v.round.order.order_id])}>
                      <Ico name="sync" />
                      {t('orders.retry')}
                    </button>
                  }
                />
              ) : (
                !v.ready && (
                  <div className="vgroup" aria-busy="true">
                    <div className="sk sk--row" />
                  </div>
                )
              )}
              {v.remove.length > 0 && (
                <div className="vgroup" data-group="remove">
                  <div className="vgh">
                    <span className="ar__ic c-info">
                      <Ico name="x" />
                    </span>
                    <span>
                      {t('void_all.remove_group')} <small>{t('void_all.remove_group.sub')}</small>
                    </span>
                    <span className="end">{fill(t(v.remove.length === 1 ? 'void_all.lines' : 'void_all.lines_n'), { n: String(v.remove.length) })}</span>
                  </div>
                  {v.remove.map((p) => (
                    <div className="vrow" key={p.order_item_id} data-line={p.order_item_id}>
                      {nameRow(p, v.byId)}
                      <span />
                      <span className="amt num" dir={MONEY_DIR}>
                        {money(removeAmount(p, v.all))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {v.void.length + v.locked.length > 0 && (
                <div className="vgroup" data-group="void">
                  <div className="vgh">
                    <span className="ar__ic c-danger">
                      <VIco name="bin" />
                    </span>
                    <span>
                      {t('void_all.void_group')} <small>{t(approval ? 'void_all.void_group.sub' : 'void_all.void_group.sub_direct')}</small>
                    </span>
                    {/* one sheet-level Waste all (v1.0.5 §8), drawn in the first Void group's header as the frames do */}
                    {v === firstVoid && (
                      <span className="end">
                        <button
                          type="button"
                          className="tgl"
                          role="switch"
                          aria-checked={wasteAll}
                          disabled={frozen}
                          onClick={() => {
                            setWasteAll(!wasteAll);
                            setPicked(new Map());
                          }}
                        >
                          <i />
                          {t('void_all.waste_all')}
                        </button>
                      </span>
                    )}
                  </div>
                  {v.void.map((p) => {
                    const partly = movedPartly(p, linesOf(v.round.order.order_id));
                    return (
                      <div className="vrow" key={p.order_item_id} data-line={p.order_item_id}>
                        {nameRow(p, v.byId)}
                        <select
                          className={wasteAll || picked.has(p.order_item_id) ? 'dsel is-set' : 'dsel'}
                          aria-label={fill(t('void_all.dsel.label'), { item: v.byId.get(p.order_item_id)?.name ?? '' })}
                          value={dispositionOf(p)}
                          disabled={busy || frozen}
                          onChange={(e) => setPicked(new Map(picked).set(p.order_item_id, e.target.value as VoidDisposition))}
                        >
                          {VOID_DISPOSITIONS.filter((x) => dispositionEnabled(p, x)).map((x) => (
                            <option key={x} value={x}>
                              {x === 'moved' ? t(partly ? 'void_all.dsel.moved_partly' : 'void_all.dsel.moved') : t(DISPOSITION_KEY[x].label)}
                            </option>
                          ))}
                        </select>
                        <span className="amt num" dir={MONEY_DIR}>
                          {money(p.refund_minor)}
                        </span>
                      </div>
                    );
                  })}
                  {v.locked.map((p) => (
                    <div className="vrow done" key={p.order_item_id} data-line={p.order_item_id}>
                      {nameRow(p, v.byId)}
                      <span className="vptag">
                        <VIco name="hourglass" />
                        {t('void.pending.tag')}
                      </span>
                      <span className="amt num" dir={MONEY_DIR}>
                        {money(p.refund_minor)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="vcol">
          <div className="fld">
            <span className="vlab">
              {t('comp.reason')}
              <small>{t('void_all.reason_sub')}</small>
            </span>
            <div className="chips--r">
              {REASON_CHIPS.map((code) => (
                <button key={code} type="button" className="chip" aria-pressed={reason === code} disabled={frozen} onClick={() => setReason(code)}>
                  {t(REASON_KEY[code])}
                </button>
              ))}
            </div>
            {reason === 'other' && (
              <label className="vnote">
                <span className="lbl">
                  {t('void.note.label')} <span className="cnt">{fill(t('void.note.count'), { n: String(note.length) })}</span>
                </span>
                <input className={note.trim() === '' ? 'inp err' : 'inp'} dir="auto" maxLength={VOID_NOTE_MAX} placeholder={t('void.note.placeholder')} value={note} readOnly={frozen} onChange={(e) => setNote(e.target.value)} />
              </label>
            )}
            {anyOther && (
              <label className="vnote" data-note="disposition">
                <span className="lbl">
                  {t('void_all.disposition_note')} <span className="cnt">{fill(t('void.note.count'), { n: String(dispositionNote.length) })}</span>
                </span>
                <input
                  className={dispositionNote.trim() === '' ? 'inp err' : 'inp'}
                  dir="auto"
                  maxLength={VOID_NOTE_MAX}
                  placeholder={t('void.disposition.other.placeholder')}
                  value={dispositionNote}
                  readOnly={frozen}
                  onChange={(e) => setDispositionNote(e.target.value)}
                />
              </label>
            )}
          </div>
          <div className="grow" />
          <div className="vsum">
            <span>{t('void.amount')}</span>
            <strong className="num" dir={MONEY_DIR}>
              {allReady ? money(total) : '—'}
            </strong>
            <small>
              {n > 0 && t('void_all.removed_now')}{' '}
              {m > 0 &&
                (approval ? (
                  <span className="appr">
                    <Ico name="shield" />
                    {t('void_all.each_waits')}
                  </span>
                ) : (
                  t('void.amount.direct')
                ))}
            </small>
          </div>
          <div className="acts">
            <button type="button" className="btn" onClick={onClose}>
              {t('void_all.keep')}
            </button>
            <OffButton off={off} className={approval ? 'btn btn--primary' : 'btn btn--danger'} onClick={() => void send()}>
              {approval ? <Ico name="shield" /> : <VIco name="bin" />}
              {label}
            </OffButton>
          </div>
        </div>
      </div>
    </VoidDialog>
  );
}
