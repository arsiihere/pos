import { useEffect, useReducer, useRef, useState } from 'react';
import { navigate } from '../../../../app/router';
import { newUlid } from '../../../../app/ulid';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import { definitiveRefusal } from '../../tables/errors';
import type { RemoveItemsPayload, SeatingLine } from '../contracts';
import { showOrderError, type LineOrder } from '../view/LineActions';

// 02b v1.0.11 §8 Zone items, §3.5 (frames ZoneUndo, ZoneUndoLate): a line served from the zone counter can be undone
// from the table view within the branch's `zone_undo_ms` of its ItemAdded (`added_at`, hub clock — never a fixed 5
// min): "Undo · m:ss" = RemoveItems of that line (all its live units; the hub always adds them back to the zone count),
// then ReleaseTableLock. After the window: "Too late to undo here" + Zone stock (the Count screen). One command_id per
// undo until a 2xx or a definitive refusal (a lost reply is sent again with the same id, never removed twice).

export interface ZoneUndoProps {
  line: SeatingLine;
  order: LineOrder;
  /** RemoveItems needs the lock: the container says if this person may (02a requireLock) */
  canTakeOrder: boolean;
  onChanged(): void;
}

/** "4:12" for 252 000 ms (whole seconds, rounded up); "0:00" at the end. */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function ZoneUndo({ line, order, canTakeOrder, onChanged }: ZoneUndoProps) {
  const shell = useShell();
  const undoMs = shell.config.config()?.zone_undo_ms ?? null;
  const left = undoMs === null ? null : line.added_at + undoMs - shell.clock.nowMs();
  // the hub removes while now − added_at <= zone_undo_ms (remove-items.ts)
  const open = left !== null && left >= 0;
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ commandId: string; payload: RemoveItemsPayload } | null>(null);
  // the m:ss moves with the hub clock; this repaints only, it never reads
  useEffect(() => {
    if (!open) return;
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [open]);
  if (!line.zone_served || line.live_units === 0 || undoMs === null || order.billed) return null;
  const zone =
    shell.config
      .snapshot()
      ?.floors.flatMap((f) => f.zones)
      .find((z) => z.zone_id === line.served_from_zone_id)?.name ?? '';

  const undo = async () => {
    if (busy || order.seating_id === undefined || order.table_id === undefined) return;
    // RemoveItems is online only (not queueable, §3.12)
    if (!shell.online) {
      shell.toasts.show({ text: t('tables.toast.needs_hub'), tone: 'warn' });
      return;
    }
    const a = (attempt.current ??= {
      commandId: newUlid(),
      payload: { order_id: order.order_id, seating_id: order.seating_id, lines: [{ order_item_id: line.order_item_id, units: line.live_units }] },
    });
    setBusy(true);
    const answer = await shell.api.command('RemoveItems', a.payload, { commandId: a.commandId });
    if (answer.ok) {
      attempt.current = null;
      // the undo is done with the table: let it go for the next person (02a Release)
      await shell.tables.releaseTableLock({ table_id: order.table_id, seating_id: order.seating_id });
      setBusy(false);
      shell.toasts.show({ text: t('stage.badge.removed') });
      onChanged();
      return;
    }
    setBusy(false);
    if (definitiveRefusal(answer.error) === null && answer.error.kind !== 'signed_out') {
      shell.toasts.show({ text: t('line.err.lost'), tone: 'warn' });
      return;
    }
    attempt.current = null;
    showOrderError(shell, answer.error, onChanged);
  };

  if (!open) {
    return (
      <>
        <span className="muted">
          <Ico name="info" /> {t('zone.too_late')}
        </span>
        <button type="button" className="btn" onClick={() => navigate('/zones')}>
          <Ico name="tray" />
          {t('zone.title')}
        </button>
      </>
    );
  }
  if (!canTakeOrder) return null;
  return (
    <>
      <button type="button" className="btn btn--tone c-brand" disabled={busy} onClick={() => void undo()}>
        <Ico name="undo" />
        {fill(t('zone.undo'), { time: mmss(left) })}
      </button>
      <span className="muted">{fill(t('zone.undo_hint'), { n: String(line.live_units), zone })}</span>
    </>
  );
}
