import { useRef, useState } from 'react';
import { childQuantity } from '@pos/domain';
import { newUlid } from '../../../../app/ulid';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { definitiveRefusal } from '../../tables/errors';
import type { CompLinePayload, CompResult, LineView, SeatingLine } from '../contracts';
import { MONEY_DIR, money, nextShareMinor } from '../money';
import { showOrderError, Sheet, type LineOrder } from '../view/LineActions';
import { compPayload, NOTE_MAX, reasonChips, type ReasonChip } from './comp-reasons';
import { pendingCompsOf } from './pending-comps';

// 02b v1.0.11 §3.9, §6.8 (frames 02b-D33 Comp, CompItYes): give units of a line free. Units stepper, the reason chips
// (Q-19), "Ask for approval" when the grant is requires_approval (else "Comp"), "Pick a reason" until a chip is
// chosen. Online only. A pending result opens the waiting card (this device's memory until H6, pending-comps.ts).
// The amount shown is a preview of the §3.4 next free shares over the line and every line the comp touches (option
// children, a deal's parts); the hub's `value_minor` is the truth.

export interface CompSheetProps {
  line: SeatingLine;
  order: LineOrder;
  /** CompItYes: units filled in */
  units?: number;
  onClose(): void;
  onDone(): void;
  onChanged(): void;
}

/**
 * Units a comp of `n` parent units takes from a child / part line — the hub's `cascadeUnits('comp', …)` (orders/
 * ledger.ts): capped at the child's free units, the parent's last free units take all of them, else
 * `childQuantity(child.units / parent.units, n, sale unit)` (01c §3.4.2; a deal's parts count as piece). Null when
 * the child's units are not a whole multiple of the parent's (the hub refuses that shape too).
 */
export function cascadedUnits(parent: LineView, child: LineView, n: number): number | null {
  if (parent.units < 1 || child.units % parent.units !== 0) return null;
  const cap = child.live_units - child.comped_units;
  const parentLeft = parent.live_units - parent.comped_units;
  if (n === parentLeft) return Math.max(0, cap);
  const per = child.units / parent.units;
  return Math.max(0, Math.min(childQuantity(per, n, parent.line_kind === 'deal' ? 'piece' : parent.sale_unit), cap));
}

/**
 * §3.9 value_minor preview, as the hub's `planComp`: Σ over the line (not a deal header) and every child / part the
 * comp touches of its next free shares (§3.4, `nextShareMinor`). Shown in the sheet only; the waiting card shows the
 * hub's amount.
 */
export function compPreviewMinor(line: LineView, all: readonly LineView[], n: number): number | null {
  let total = 0;
  if (line.line_kind !== 'deal') {
    const own = nextShareMinor(line, n);
    if (own === null) return null;
    total += own;
  }
  const childKind = line.line_kind === 'deal' ? 'deal_part' : line.line_kind === 'item' ? 'option_child' : null;
  for (const child of all.filter((l) => l.parent_order_item_id === line.order_item_id && l.line_kind === childKind)) {
    const units = cascadedUnits(line, child, n);
    if (units === null) return null;
    if (units === 0) continue;
    const share = nextShareMinor(child, units);
    if (share === null) return null;
    total += share;
  }
  return total;
}

export function CompSheet({ line, order, units: given, onClose, onDone, onChanged }: CompSheetProps) {
  const shell = useShell();
  const max = line.live_units - line.comped_units;
  const [units, setUnits] = useState(Math.max(1, Math.min(given ?? 1, max)));
  const [chip, setChip] = useState<ReasonChip | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const chips = reasonChips(shell.config.config()?.comp_reason_chips ?? []);
  const approval = !shell.permissions.allowed('apply-comp');
  const preview = compPreviewMinor(line, order.lines, units);
  const payload = compPayload({ order_item_id: line.order_item_id, units, max_units: max, chip, note });

  /** one submission = one command_id until a 2xx or a definitive refusal (D32 / M19: a lost reply is never a 2nd comp) */
  const attempt = useRef<{ commandId: string; payload: CompLinePayload } | null>(null);

  const send = async () => {
    if (busy) return;
    const a = attempt.current ?? (payload === null ? null : { commandId: newUlid(), payload });
    if (a === null) return;
    attempt.current = a;
    setBusy(true);
    const answer = await shell.api.command<CompResult>('CompLine', a.payload, { commandId: a.commandId });
    setBusy(false);
    const store = pendingCompsOf(shell);
    if (!answer.ok) {
      const e = answer.error;
      if (definitiveRefusal(e) === null && e.kind !== 'signed_out') {
        shell.toasts.show({ text: t('line.err.lost'), tone: 'warn' });
        return;
      }
      attempt.current = null;
      // one open request per line (dedupe 'comp:<order_item_id>'): show the OPEN request's card, not this one
      if (e.kind === 'api' && e.code === 'COMP_PENDING' && typeof e.details['alert_id'] === 'string') {
        const open = line.pending_comp ?? null;
        const same = open !== null && open.alert_id === e.details['alert_id'];
        store.remember(
          { alert_id: e.details['alert_id'], order_item_id: line.order_item_id, units: same ? open.units : null, value_minor: same ? open.value_minor : null, reason: null },
          false,
        );
        void store.sync();
        shell.toasts.show({ text: t('order.toast.comp_asked'), tone: 'info' });
        onDone();
        return;
      }
      showOrderError(shell, e, onChanged);
      return;
    }
    attempt.current = null;
    const r = answer.data;
    if ('pending' in r) {
      // Q-11: the amount is the hub's value_minor; none when the hub does not send it
      store.remember({ alert_id: r.alert_id, order_item_id: line.order_item_id, units: a.payload.units, value_minor: r.value_minor ?? null, reason: chip?.label ?? null }, true);
      shell.toasts.show({ text: t('order.toast.comp_asked') });
    } else {
      shell.toasts.show({ text: fill(t('stage.badge.comped'), { n: String(a.payload.units) }) });
    }
    onDone();
  };

  const button = chip === null ? t('comp.pick_reason') : approval ? t('comp.ask') : t('comp.do');
  return (
    <Sheet
      title={fill(t('comp.title'), { item: line.name })}
      sub={approval ? t('comp.needs_manager') : undefined}
      ident={order.ident}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" disabled={(payload === null && attempt.current === null) || busy} onClick={() => void send()}>
            <Ico name={approval ? 'send' : 'check'} />
            {button}
          </button>
        </>
      }
    >
      <div className="qline">
        <b>{t('comp.units')}</b>
        <span className="step">
          <button type="button" aria-label="-" disabled={units <= 1} onClick={() => setUnits(Math.max(1, units - 1))}>
            −
          </button>
          <output className="num">{units}</output>
          <button type="button" aria-label="+" disabled={units >= max} onClick={() => setUnits(Math.min(max, units + 1))}>
            +
          </button>
        </span>
        <span className="pv">
          {preview !== null && (
            <strong className="num" dir={MONEY_DIR}>
              {money(preview)}
            </strong>
          )}
        </span>
      </div>
      <div className="fld">
        <span className="fld__l">
          {t('comp.reason')}
          <small>{t('comp.required')}</small>
        </span>
        <div className="chips">
          {chips.map((c) => (
            <button key={c.code} type="button" className="chip" aria-pressed={chip?.code === c.code} onClick={() => setChip(c)} dir="auto">
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {chip?.other === true && (
        <label className="fld">
          <span className="fld__l">
            {t('comp.note')}
            <small>{t('comp.required')}</small>
          </span>
          <input className="inp" dir="auto" maxLength={NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
    </Sheet>
  );
}
