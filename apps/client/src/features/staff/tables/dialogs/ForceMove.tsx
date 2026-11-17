import { useRef, useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import type { HubError } from '../../../../api/hub-admin';
import { useShell } from '../../shell/hooks';
import type { SeatingRef } from '../contracts';
import { FORCE_MOVE_REASONS, encodeReason, reasonLabel, type ReasonToken } from '../sheet/reasons';
import { CandidatePick, CandidatesPending, candidateSub, useCandidates, type CandidateRow } from './HandOver';
import { DialogFrame } from './TableBusy';

// 02a §6.8 (02a-D21 ForceMove): `ForceMoveTable { table_id, seating_id, to_staff_id, reason }` — the receiver is
// not asked, the move is logged. The candidates of `handover-candidates` plus a "Me" row (the caller is excluded
// there; handoff Q12) shown only when my take-order grant can cover the floor (branch / my_floors: Q-15 grant only;
// the hub answers `422 no_permission` otherwise). A reason chip is required, sent as its token (Q-18).

export interface ForceMoveProps {
  code: string;
  seating: SeatingRef;
  onClose(): void;
  onMoved(): void;
  onFailed(error: HubError): void;
}

export function ForceMove({ code, seating, onClose, onMoved, onFailed }: ForceMoveProps) {
  const { tables, permissions, me } = useShell();
  const { list, failed, reload } = useCandidates(seating.table_id);
  const [picked, setPicked] = useState<string | null>(null);
  const [token, setToken] = useState<ReasonToken | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** one send at a time (a ref: two taps before the re-render cannot both send) */
  const inflight = useRef(false);

  const scope = permissions.scope('take-order');
  const meRow: CandidateRow | null =
    me !== null && permissions.allowed('take-order') && (scope === 'branch' || scope === 'my_floors')
      ? { staff_id: me.staff_id, name: t('forcemove.me'), sub: fill(t('forcemove.me_sub'), { name: me.name }), pickable: true, me: true }
      : null;
  const rows: CandidateRow[] = [
    ...(meRow === null ? [] : [meRow]),
    ...(list ?? []).map((c) => ({ staff_id: c.staff_id, name: c.name, sub: candidateSub(c), pickable: c.working })),
  ];
  const chosen = rows.find((r) => r.staff_id === picked && r.pickable) ?? null;

  async function give(): Promise<void> {
    if (chosen === null || token === null || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    const answer = await tables.forceMoveTable({ ...seating, to_staff_id: chosen.staff_id, reason: encodeReason(token, '') });
    inflight.current = false;
    setBusy(false);
    if (answer.ok) {
      onMoved();
      return;
    }
    const e = answer.error;
    if (e.kind === 'api' && e.code === 'HANDOVER_TARGET_UNAVAILABLE') {
      setGone(chosen.name);
      setPicked(null);
      await reload();
      return;
    }
    onFailed(e);
  }

  return (
    <DialogFrame
      code={code}
      title={fill(t('forcemove.title'), { table: code, name: chosen?.name ?? '…' })}
      sub={chosen === null ? undefined : fill(t('forcemove.sub'), { name: chosen.name })}
      wide
      onClose={onClose}
    >
      {gone !== null && (
        <div className="msg c-danger" role="alert">
          <span>{fill(t('handover.gone'), { name: gone })}</span>
        </div>
      )}
      {list === null ? <CandidatesPending failed={failed} onRetry={() => void reload()} /> : <CandidatePick rows={rows} picked={chosen?.staff_id ?? null} onPick={setPicked} />}
      <div className="fld" role="group" aria-label={t('release.reason')}>
        <span className="fld__l">
          {t('release.reason')}
          <small>{t('release.required')}</small>
        </span>
        <div className="chips">
          {FORCE_MOVE_REASONS.map((r) => (
            <button key={r} type="button" className="chip" aria-pressed={token === r} onClick={() => setToken(r)}>
              {reasonLabel(r)}
            </button>
          ))}
        </div>
      </div>
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--danger" disabled={chosen === null || token === null || busy} onClick={() => void give()}>
          {t('forcemove.give')}
        </button>
      </div>
    </DialogFrame>
  );
}
