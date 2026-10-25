// S35 i: UI kit staff tiles (the admin roster, 02's staff login). Data and callbacks only.
export interface StaffTile {
  staff_id: string;
  display_name: string;
  locked?: boolean;
}

export function StaffTiles({
  staff,
  selectedId,
  onPick,
}: {
  staff: readonly StaffTile[];
  selectedId: string | null;
  onPick: (staffId: string) => void;
}) {
  return (
    <div className="pos-staff">
      {staff.map((s) => (
        <button
          key={s.staff_id}
          type="button"
          className={`pos-staff__tile${s.locked === true ? ' is-locked' : ''}`}
          aria-pressed={s.staff_id === selectedId}
          disabled={s.locked === true}
          onClick={() => onPick(s.staff_id)}
        >
          {s.display_name}
        </button>
      ))}
    </div>
  );
}
