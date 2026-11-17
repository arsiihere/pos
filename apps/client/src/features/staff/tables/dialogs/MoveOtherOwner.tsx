import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { DialogFrame } from './TableBusy';

// 02a §8 Table sheet, §3.10–§3.12 (02a-D25 MoveOtherOwner): `403 PERMISSION_DENIED { reason: 'other_owner',
// table_id, assigned_staff_id, holder_staff_id }` from Move / Join / Split. Q-25: "Hand over to Sara" (Hand over
// preset to her) only when `assigned_staff_id` is set and is not me; otherwise the text names `holder_staff_id`
// with OK (absorbing someone else's party: the assignee is not the person to hand to).

export type OtherOwner = { kind: 'assignee'; staff_id: string; name: string; table: string } | { kind: 'holder'; name: string };

/** Which variant a 403 other_owner shows (Q-25). Names come from the map. */
export function otherOwnerOf(details: Record<string, unknown>, me: string | null, nameOf: (staff_id: string) => string, tableName: (table_id: string) => string): OtherOwner {
  const assigned = details['assigned_staff_id'];
  if (typeof assigned === 'string' && assigned !== '' && assigned !== me) {
    const table = details['table_id'];
    return { kind: 'assignee', staff_id: assigned, name: nameOf(assigned), table: typeof table === 'string' ? tableName(table) : '' };
  }
  const holder = details['holder_staff_id'];
  return { kind: 'holder', name: typeof holder === 'string' ? nameOf(holder) : '' };
}

export interface MoveOtherOwnerProps {
  /** the sheet's table chip */
  code: string;
  owner: OtherOwner;
  onClose(): void;
  /** Hand over, preset to the assignee */
  onHandOver(staff_id: string): void;
}

export function MoveOtherOwner({ code, owner, onClose, onHandOver }: MoveOtherOwnerProps) {
  if (owner.kind === 'holder') {
    return (
      <DialogFrame code={code} title={fill(t('tables.err.other_owner_holder'), { name: owner.name })} onClose={onClose}>
        <div className="acts">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            {t('tables.ok')}
          </button>
        </div>
      </DialogFrame>
    );
  }
  return (
    <DialogFrame code={owner.table === '' ? code : owner.table} title={fill(t('move.owner_title'), { table: owner.table, name: owner.name })} onClose={onClose}>
      <p className="dlg__line">{fill(t('move.owner_line'), { from: code, name: owner.name })}</p>
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => onHandOver(owner.staff_id)}>
          {fill(t('move.owner_go'), { name: owner.name })}
        </button>
      </div>
    </DialogFrame>
  );
}
