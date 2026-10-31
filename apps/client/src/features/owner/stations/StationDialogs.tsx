import { useState, type FormEvent } from 'react';
import type { CloudAdmin, CompletionMode, Program, StationType } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { Segmented } from '../../../components/Segmented';
import { fill } from '../../../i18n/en';
import { t, type MessageKey } from '../../../i18n';
import { useCloudDown } from '../cloud';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { formatMinutes, parseMinutes } from '../minutes';

// 01a-S04: the add-station dialog (OwnerAddStation) and the batch recipe dialog (OwnerAddRecipe), new or
// edit. A recipe archives at once with an Undo chip in the view (S50 b).
const WHOLE_RE = /^[0-9]+$/;

export function parseWhole(text: string): number | null {
  const trimmed = text.trim();
  return WHOLE_RE.test(trimmed) ? Number(trimmed) : null;
}

export const COMPLETION_MODES: { value: CompletionMode; label: MessageKey }[] = [
  { value: 'two_tap', label: 'owner.stations.mode_two_tap' },
  { value: 'single_tap', label: 'owner.stations.mode_single_tap' },
  { value: 'auto_done', label: 'owner.stations.mode_auto_done' },
];

export function typeOptions(): { value: StationType; label: string }[] {
  return [
    { value: 'slot', label: t('owner.stations.type_slot') },
    { value: 'batch', label: t('owner.stations.type_batch') },
  ];
}

export function AddStationDialog({
  api,
  branchId,
  onCreated,
  onMismatch,
  onClose,
}: {
  api: CloudAdmin;
  branchId: string;
  onCreated: () => void;
  onMismatch: () => void;
  onClose: () => void;
}) {
  const { key, renew } = useIdempotencyKey();
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<StationType>('slot');
  const [capacity, setCapacity] = useState('');
  const [freshness, setFreshness] = useState('');
  const [mode, setMode] = useState<CompletionMode>('two_tap');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const down = useCloudDown(api);
  const leave = useLeave();
  const touched = name !== '' || label !== '' || capacity !== '' || freshness !== '';
  useDirtyForm(touched ? { name: t('owner.stations.new_station_title'), fields: [t('owner.stations.station_name').toLowerCase()] } : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const capacityValue = parseWhole(capacity);
    const freshnessValue = type === 'batch' && freshness.trim() !== '' ? parseMinutes(freshness) : undefined;
    if (capacityValue === null || freshnessValue === null) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      location_label: label.trim() === '' ? null : label.trim(),
      station_type: type,
      capacity: capacityValue,
      ...(freshnessValue === undefined ? {} : { freshness_window_ms: freshnessValue }),
      completion_mode: mode,
    };
    const result = await api.createStation(branchId, body, key);
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result.error));
      if (isKeyMismatch(result.error)) {
        renew();
        onMismatch();
      }
      return;
    }
    renew();
    onCreated();
  }

  return (
    <Dialog title={t('owner.stations.new_station_title')} onClose={() => leave(onClose)} form>
      <form className="pos-stack" data-form="add-station" noValidate onSubmit={(e) => void submit(e)}>
        <p className="pos-dialog__body">{t('owner.stations.new_station_body')}</p>
        <div className="pos-grid">
          <label className="pos-field">
            <span className="pos-field__label">{t('owner.stations.station_name')}</span>
            <input className="pos-input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="pos-field">
            <span className="pos-field__label">{t('owner.stations.location_label')}</span>
            <input className="pos-input" name="location_label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
        </div>
        <div className="pos-field">
          <span className="pos-field__label">{t('owner.stations.type')}</span>
          <Segmented label={t('owner.stations.type')} options={typeOptions()} value={type} onChange={setType} block />
        </div>
        <div className="pos-grid">
          <label className="pos-field">
            <span className="pos-field__label">{t(type === 'batch' ? 'owner.stations.capacity_batch' : 'owner.stations.capacity')}</span>
            <input
              className="pos-input pos-input--mono"
              name="capacity"
              inputMode="numeric"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </label>
          {type === 'batch' && (
            <label className="pos-field">
              <span className="pos-field__label">{t('owner.stations.freshness_minutes')}</span>
              <input
                className="pos-input pos-input--mono"
                name="freshness_minutes"
                inputMode="decimal"
                value={freshness}
                onChange={(e) => setFreshness(e.target.value)}
              />
              <span className="pos-field__help">{t('owner.stations.freshness_help')}</span>
            </label>
          )}
        </div>
        <label className="pos-field">
          <span className="pos-field__label">{t('owner.stations.completion_mode')}</span>
          <select
            className="pos-select"
            name="completion_mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as CompletionMode)}
          >
            {COMPLETION_MODES.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
        {error !== null && <Banner tone="danger" text={error} />}
        <div className="pos-dialog__footer">
          <button type="button" className="pos-btn" onClick={() => leave(onClose)}>
            {t('common.cancel')}
          </button>
          <BusyButton busy={busy} primary disabled={down} type="submit">
            {t('owner.stations.add_station')}
          </BusyButton>
        </div>
      </form>
    </Dialog>
  );
}

export function RecipeDialog({
  api,
  branchId,
  stationId,
  stationName,
  program,
  onSaved,
  onArchive,
  onMismatch,
  onClose,
}: {
  api: CloudAdmin;
  branchId: string;
  stationId: string;
  stationName: string;
  program: Program | null;
  onSaved: () => void;
  onArchive: () => void;
  onMismatch: () => void;
  onClose: () => void;
}) {
  const { key, renew } = useIdempotencyKey();
  const [name, setName] = useState(program?.name ?? '');
  const [cook, setCook] = useState(program === null ? '' : formatMinutes(program.cook_time_ms));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const down = useCloudDown(api);
  const leave = useLeave();
  const changed =
    program === null ? name !== '' || cook !== '' : name.trim() !== program.name || cook !== formatMinutes(program.cook_time_ms);
  useDirtyForm(changed ? { name: program?.name ?? t('owner.stations.new_program_title'), fields: [t('owner.stations.program_name').toLowerCase()] } : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cookMs = program !== null && cook === formatMinutes(program.cook_time_ms) ? program.cook_time_ms : parseMinutes(cook);
    if (cookMs === null) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    setBusy(true);
    setError(null);
    const result =
      program === null
        ? await api.createProgram(branchId, stationId, { name: name.trim(), cook_time_ms: cookMs }, key)
        : await api.patchProgram(branchId, stationId, program.program_id, {
            ...(name.trim() !== program.name ? { name: name.trim() } : {}),
            ...(cookMs !== program.cook_time_ms ? { cook_time_ms: cookMs } : {}),
          });
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result.error));
      if (isKeyMismatch(result.error)) {
        renew();
        onMismatch();
      }
      return;
    }
    renew();
    onSaved();
  }

  return (
    <Dialog
      title={program === null ? fill(t('owner.stations.new_program_for'), { name: stationName }) : program.name}
      onClose={() => leave(onClose)}
      form
    >
      <form className="pos-stack" data-form="add-program" noValidate onSubmit={(e) => void submit(e)}>
        <p className="pos-dialog__body">{t('owner.stations.program_body')}</p>
        <div className="pos-grid">
          <label className="pos-field">
            <span className="pos-field__label">{t('owner.stations.program_name')}</span>
            <input className="pos-input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="pos-field">
            <span className="pos-field__label">{t('owner.stations.cook_minutes')}</span>
            <input
              className="pos-input pos-input--mono"
              name="cook_minutes"
              inputMode="decimal"
              value={cook}
              onChange={(e) => setCook(e.target.value)}
            />
            <span className="pos-field__help">{t('owner.stations.cook_help')}</span>
          </label>
        </div>
        {program !== null && program.archived_at === null && (
          <div className="pos-dialog__danger">
            <strong>{t('owner.stations.archive_program')}</strong>
            <button type="button" className="pos-btn pos-btn--danger" disabled={down} onClick={onArchive}>
              {t('owner.common.archive')}
            </button>
          </div>
        )}
        {error !== null && <Banner tone="danger" text={error} />}
        <div className="pos-dialog__footer">
          <button type="button" className="pos-btn" onClick={() => leave(onClose)}>
            {t('common.cancel')}
          </button>
          <BusyButton busy={busy} primary disabled={down} type="submit">
            {t(program === null ? 'owner.stations.add_program' : 'owner.stations.save_program')}
          </BusyButton>
        </div>
      </form>
    </Dialog>
  );
}
