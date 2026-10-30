import { fill } from '../i18n/en';
import { t } from '../i18n';
import { Icon } from './Icon';

// S35 i: UI kit staff tiles (the admin roster, 02's staff login). Data and callbacks only.
// S54 d: the roster sends `locked_until` only while the hub holds a lock, so any value means locked
// (a wrong device clock must not unlock the tile). The note's minutes are rounded up against the
// device clock (`now`), display only.
export interface StaffTile {
  staff_id: string;
  display_name: string;
  locked_until?: number | null;
  // The line under the name when not locked (the roster's role names, 01a-S10 StockPin).
  sub?: string;
}

export function StaffTiles({
  staff,
  selectedId,
  onPick,
  now = Date.now(),
}: {
  staff: readonly StaffTile[];
  selectedId: string | null;
  onPick: (staffId: string) => void;
  now?: number;
}) {
  return (
    <div className="pos-staff">
      {staff.map((s) => {
        const locked = s.locked_until != null;
        const left = locked ? (s.locked_until ?? 0) - now : 0;
        return (
          <button
            key={s.staff_id}
            type="button"
            className={`pos-staff__tile${locked ? ' is-locked' : ''}`}
            aria-pressed={s.staff_id === selectedId}
            disabled={locked}
            onClick={() => onPick(s.staff_id)}
          >
            {s.display_name}
            {locked ? (
              <small>
                <Icon name="lock" />
                {left > 0 ? fill(t('staff.locked_for'), { n: String(Math.ceil(left / 60_000)) }) : t('staff.locked')}
              </small>
            ) : (
              s.sub !== undefined && s.sub !== '' && <small>{s.sub}</small>
            )}
          </button>
        );
      })}
    </div>
  );
}
