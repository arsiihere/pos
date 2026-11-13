import { useRef, useState } from 'react';
import { t, type MessageKey } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { HubError } from '../../../../api/hub-admin';
import { useShell } from '../../shell/hooks';
import type { CallWaiterChip, CallWaiterResult, SeatingRef } from '../contracts';
import { DialogFrame } from './TableBusy';

// 02a §3.13, §6.14 (02a-D23 CallWaiter, CallWaiterNobody): four chips, one tap sends `CallWaiter` straight to the
// hub — never queued (§8 Offline: "Needs the hub"). Q-16: the sub line names nobody (no query gives the team), a
// repeat (`repeated: true`) toasts "Already called" with no time, and "Call sent" is this device's own memory
// (`localFlags`, the tile flag). `recipients: 0` → "Nobody else is working".

const CHIPS: readonly CallWaiterChip[] = ['water', 'clear', 'come', 'other'];
/** handoff CHANGES: "Come to the table" is outlined as the default */
const DEFAULT_CHIP: CallWaiterChip = 'come';

export interface CallWaiterProps {
  code: string;
  seating: SeatingRef;
  onClose(): void;
  onFailed(error: HubError): void;
}

export function CallWaiter({ code, seating, onClose, onFailed }: CallWaiterProps) {
  const { tables, toasts, localFlags, clock } = useShell();
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);

  /** Cancel / Close do nothing while the call is in flight (no cancel → reopen → second send) */
  const close = () => {
    if (!inflight.current) onClose();
  };

  async function call(chip: CallWaiterChip): Promise<void> {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(true);
    const answer = await tables.callWaiter({ ...seating, chip });
    inflight.current = false;
    setBusy(false);
    if (!answer.ok) {
      onFailed(answer.error);
      return;
    }
    const r: CallWaiterResult = answer.data;
    // the call is open on the hub (new or the same one): this device shows "Call sent" from now, or from its first tap
    if (localFlags.callSentAt(seating.table_id) === null || !r.repeated) localFlags.markCallSent(seating.table_id, clock.nowMs());
    if (r.repeated) toasts.show({ text: t('tables.toast.already_called'), tone: 'info' });
    else if (r.recipients === 0) toasts.show({ text: t('call.nobody'), sub: t('call.nobody_sub'), tone: 'warn' });
    else toasts.show({ text: t('tables.toast.waiter_called'), tone: 'ok' });
    onClose();
  }

  return (
    <DialogFrame code={code} title={fill(t('call.title'), { table: code })} sub={t('call.sub')} onClose={close}>
      <div className="bchips">
        {CHIPS.map((chip) => (
          <button key={chip} type="button" className={chip === DEFAULT_CHIP ? 'bchip def' : 'bchip'} disabled={busy} onClick={() => void call(chip)}>
            {t(`call.chip.${chip}` as MessageKey)}
          </button>
        ))}
      </div>
      <div className="acts acts--1">
        <button type="button" className="btn" disabled={busy} onClick={close}>
          {t('common.cancel')}
        </button>
      </div>
    </DialogFrame>
  );
}
