import { useState } from 'react';
import type { CloudAdmin, CloudError, Floor, PatchTableBody, Table } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { useBranchName } from '../branch';
import { useCloudDown } from '../cloud';
import { errorText } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { parseSeats } from './BulkTables';

// 01a-S03 OwnerTableDialog: name, seats, floor (a PATCH can move the table, §6.6) and position. Archive
// sends at once; the view shows the Undo chip (S50 b).
const INT_RE = /^-?[0-9]+$/;

export function TableDialog({
  api,
  branchId,
  table,
  floorId,
  floors,
  onSaved,
  onArchive,
  onRestore,
  onClose,
}: {
  api: CloudAdmin;
  branchId: string;
  table: Table;
  floorId: string;
  floors: readonly Floor[];
  onSaved: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const branchName = useBranchName();
  const [name, setName] = useState(table.name);
  const [seats, setSeats] = useState(table.seats === null ? '' : String(table.seats));
  const [floor, setFloor] = useState(floorId);
  const [sort, setSort] = useState(String(table.sort_order));
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const down = useCloudDown(api);
  const leave = useLeave();

  const patch: PatchTableBody = {};
  if (name.trim() !== table.name) patch.name = name.trim();
  const seatsValue = parseSeats(seats);
  if (seatsValue !== undefined && seatsValue !== table.seats) patch.seats = seatsValue;
  if (floor !== floorId) patch.floor_id = floor;
  if (INT_RE.test(sort.trim()) && Number(sort.trim()) !== table.sort_order) patch.sort_order = Number(sort.trim());
  const changed = [
    ...('name' in patch ? [t('floors.table_name').toLowerCase()] : []),
    ...('seats' in patch ? [t('floors.seats').toLowerCase()] : []),
    ...('floor_id' in patch ? [t('floors.floor').toLowerCase()] : []),
    ...('sort_order' in patch ? [t('floors.position').toLowerCase()] : []),
  ];
  useDirtyForm(changed.length === 0 ? null : { name: table.name, fields: changed });

  function shown(err: CloudError) {
    if (err.kind === 'api' && err.code === 'CONFIG_NAME_TAKEN') {
      setNameError(fill(t('errors.CONFIG_NAME_TAKEN_table'), { name: name.trim(), branch: branchName(branchId) }));
    } else setError(errorText(err));
  }

  async function save() {
    const trimmed = name.trim();
    if (trimmed.length < 1 || trimmed.length > 60 || seatsValue === undefined || !INT_RE.test(sort.trim())) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    if (changed.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    setNameError(null);
    const result = await api.patchTable(branchId, table.table_id, patch);
    setBusy(false);
    if (!result.ok) shown(result.error);
    else onSaved();
  }

  return (
    <Dialog
      title={fill(t('floors.edit_table'), { name: table.name })}
      onClose={() => leave(onClose)}
      footer={
        <>
          <button type="button" className="pos-btn" onClick={() => leave(onClose)}>
            {t('common.cancel')}
          </button>
          <BusyButton busy={busy} primary disabled={down} onClick={() => void save()}>
            {t('floors.save_table')}
          </BusyButton>
        </>
      }
    >
      <div className="pos-grid">
        <label className={`pos-field${nameError === null ? '' : ' pos-field--error'}`}>
          <span className="pos-field__label">{t('floors.table_name')}</span>
          <input className="pos-input pos-input--mono" name="name" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="pos-field__help">{t('floors.table_name_help')}</span>
          {nameError !== null && <span className="pos-field__error">{nameError}</span>}
        </label>
        <label className="pos-field">
          <span className="pos-field__label">{t('floors.seats')}</span>
          <input className="pos-input pos-input--mono" name="seats" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />
          <span className="pos-field__help">{t('floors.seats_help')}</span>
        </label>
        <label className="pos-field">
          <span className="pos-field__label">{t('floors.floor')}</span>
          <select className="pos-select" name="floor_id" value={floor} onChange={(e) => setFloor(e.target.value)}>
            {floors
              .filter((f) => f.archived_at === null || f.floor_id === floorId)
              .map((f) => (
                <option key={f.floor_id} value={f.floor_id}>
                  {f.name}
                </option>
              ))}
          </select>
        </label>
        <label className="pos-field">
          <span className="pos-field__label">{t('floors.position')}</span>
          <input className="pos-input pos-input--mono" name="sort_order" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
          <span className="pos-field__help">{t('floors.position_help')}</span>
        </label>
      </div>
      {table.archived_at !== null && (
        <button type="button" className="pos-btn" disabled={down} onClick={onRestore}>
          {t('owner.common.restore')}
        </button>
      )}
      {table.archived_at === null && (
        <div className="pos-dialog__danger">
          <div className="pos-section__head">
            <strong>{t('floors.archive_table')}</strong>
            <span>{t('floors.archive_table_body')}</span>
          </div>
          <button type="button" className="pos-btn pos-btn--danger" disabled={down} onClick={onArchive}>
            {t('owner.common.archive')}
          </button>
        </div>
      )}
      {error !== null && <Banner tone="danger" text={error} />}
    </Dialog>
  );
}
