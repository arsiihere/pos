import type { BranchEngineSettings } from '@pos/events';
import { usePhone } from '../../../app/phone';
import { Switch } from '../../../components/Switch';
import { fill } from '../../../i18n/en';
import { t, type MessageKey } from '../../../i18n';
import { formatMinutes, parseMinutes } from '../minutes';

// 01a v2.1 §8.1 (A-12), 01b v1.5 B-6: the branch settings page's "Kitchen timing" group. The weights are whole
// percents (sent as typed); every time is typed in minutes and sent as ms (minutes.ts, two decimals, so the
// 15 s and 30 s minimums are 0.25 and 0.5). The ranges are the cloud's (staff.ts BranchEngineSettings); a box
// outside its range is refused here, so the cloud's own check is never the first one the owner meets.
// 01a v2.3 §5.2a (02b A-1): three more times beside the A-12 fields, now on BranchEngineSettings (task 9).
// 01a v2.4.2 (03b v1.0.2 §4.5 B-2, owner ruling (a) 2026-11-11): "Kitchen screens and the pass" — the Pass Ready
// window, the KDS offline threshold and the 02b served estimate (1–30 min, or Off = null on the wire).
type NumericKey = Exclude<keyof BranchEngineSettings, 'returns_boost' | 'comp_reason_chips' | 'served_estimate_ms'>;
const storedOf = (base: BranchEngineSettings, key: NumericKey): number => base[key];
interface Spec {
  key: NumericKey;
  kind: 'pct' | 'ms';
  min: number;
  max: number;
  label: MessageKey;
}
const pct = (key: NumericKey, label: MessageKey): Spec => ({ key, kind: 'pct', min: 10, max: 1000, label });
const pad = (key: NumericKey, label: MessageKey): Spec => ({ key, kind: 'ms', min: 0, max: 1_800_000, label });

const WEIGHTS: Spec[] = [
  pct('weight_dine_in_pct', 'branches.timing.weight_dine_in_pct'),
  pct('weight_takeaway_pct', 'branches.timing.weight_takeaway_pct'),
  pct('weight_delivery_pct', 'branches.timing.weight_delivery_pct'),
  pct('weight_parking_pct', 'branches.timing.weight_parking_pct'),
  pct('weight_follow_up_pct', 'branches.timing.weight_follow_up_pct'),
];
const PADDINGS: Spec[] = [
  pad('promise_padding_dine_in_ms', 'branches.timing.promise_padding_dine_in_ms'),
  pad('promise_padding_takeaway_ms', 'branches.timing.promise_padding_takeaway_ms'),
  pad('promise_padding_delivery_ms', 'branches.timing.promise_padding_delivery_ms'),
  pad('promise_padding_parking_ms', 'branches.timing.promise_padding_parking_ms'),
];
const OTHERS: Spec[] = [
  { key: 'slip_threshold_ms', kind: 'ms', min: 60_000, max: 1_800_000, label: 'branches.timing.slip_threshold_ms' },
  { key: 'slip_escalate_ms', kind: 'ms', min: 30_000, max: 1_800_000, label: 'branches.timing.slip_escalate_ms' },
  { key: 'cascade_step_ms', kind: 'ms', min: 15_000, max: 300_000, label: 'branches.timing.cascade_step_ms' },
  { key: 'min_gain_ms', kind: 'ms', min: 0, max: 600_000, label: 'branches.timing.min_gain_ms' },
  { key: 'table_lock_ttl_ms', kind: 'ms', min: 60_000, max: 3_600_000, label: 'branches.timing.table_lock_ttl_ms' },
  { key: 'order_abandon_ms', kind: 'ms', min: 3_600_000, max: 86_400_000, label: 'branches.timing.order_abandon_ms' },
];
// §5.2a: the order queue's auto-send cap 60–1440 min, the zone Undo window 0–30 min, the slow-item clock 1–120 min.
const ORDERING: Spec[] = [
  { key: 'queue_auto_send_max_ms', kind: 'ms', min: 3_600_000, max: 86_400_000, label: 'branches.timing.queue_auto_send_max_ms' },
  { key: 'zone_undo_ms', kind: 'ms', min: 0, max: 1_800_000, label: 'branches.timing.zone_undo_ms' },
  { key: 'slow_item_threshold_ms', kind: 'ms', min: 60_000, max: 7_200_000, label: 'branches.timing.slow_item_threshold_ms' },
];
// 03b §4.5 A-1: Ready window 15 s–5 min, KDS offline 10 s–5 min (the 0012 CHECKs).
const KDS: Spec[] = [
  { key: 'ready_window_ms', kind: 'ms', min: 15_000, max: 300_000, label: 'branches.timing.ready_window_ms' },
  { key: 'kds_offline_ms', kind: 'ms', min: 10_000, max: 300_000, label: 'branches.timing.kds_offline_ms' },
];
const SPECS: Spec[] = [...WEIGHTS, ...PADDINGS, ...OTHERS, ...ORDERING, ...KDS];
// 03b §4.5 A-1: the served estimate, 1–30 min, or Off (null).
const SERVED = { min: 60_000, max: 1_800_000 };
// Shown in the box when the stored value is Off and the owner turns it On.
const SERVED_DEFAULT_MS = 180_000;

export type EngineState = Record<NumericKey, string> & { returns_boost: boolean; served_estimate_ms: string; served_estimate_on: boolean };

export function engineState(base: BranchEngineSettings): EngineState {
  const state = {
    returns_boost: base.returns_boost,
    served_estimate_on: base.served_estimate_ms !== null,
    served_estimate_ms: formatMinutes(base.served_estimate_ms ?? SERVED_DEFAULT_MS),
  } as EngineState;
  for (const spec of SPECS) state[spec.key] = spec.kind === 'pct' ? String(storedOf(base, spec.key)) : formatMinutes(storedOf(base, spec.key));
  return state;
}

const WHOLE_RE = /^[0-9]+$/;
// A time whose text was not touched keeps its stored ms, which two-decimal minutes may not round-trip.
function valueOf(spec: Spec, text: string, stored: number): number | null {
  if (spec.kind === 'pct') return WHOLE_RE.test(text.trim()) ? Number(text.trim()) : null;
  return text === formatMinutes(stored) ? stored : parseMinutes(text);
}

// The changed fields as a PATCH body part, plus a message per box that is outside its range.
export function enginePatch(
  state: EngineState,
  base: BranchEngineSettings,
): { patch: Partial<BranchEngineSettings>; errors: Record<string, string> } {
  const patch: Record<string, number | boolean | null> = {};
  const errors: Record<string, string> = {};
  for (const spec of SPECS) {
    const stored = storedOf(base, spec.key);
    const value = valueOf(spec, state[spec.key], stored);
    if (value === null || value < spec.min || value > spec.max) {
      errors[spec.key] =
        spec.kind === 'pct'
          ? fill(t('branches.timing_pct_range'), { min: String(spec.min), max: String(spec.max) })
          : fill(t('branches.timing_minutes_range'), { min: formatMinutes(spec.min), max: formatMinutes(spec.max) });
    } else if (value !== stored) patch[spec.key] = value;
  }
  if (state.returns_boost !== base.returns_boost) patch['returns_boost'] = state.returns_boost;
  // Off sends null and the box is not checked; On checks the box like the other times.
  if (!state.served_estimate_on) {
    if (base.served_estimate_ms !== null) patch['served_estimate_ms'] = null;
  } else {
    const stored = base.served_estimate_ms;
    const text = state.served_estimate_ms;
    const value = stored !== null && text === formatMinutes(stored) ? stored : parseMinutes(text);
    if (value === null || value < SERVED.min || value > SERVED.max) {
      errors['served_estimate_ms'] = fill(t('branches.timing_minutes_range'), { min: formatMinutes(SERVED.min), max: formatMinutes(SERVED.max) });
    } else if (value !== stored) patch['served_estimate_ms'] = value;
  }
  return { patch: patch as Partial<BranchEngineSettings>, errors };
}

export const engineFieldLabel = (key: string): string | undefined => {
  if (key === 'returns_boost') return t('branches.timing.returns_boost');
  if (key === 'served_estimate_ms') return t('branches.timing.served_estimate_ms');
  const spec = SPECS.find((s) => s.key === key);
  return spec === undefined ? undefined : t(spec.label);
};

export function KitchenTiming({
  state,
  onChange,
  errors,
}: {
  state: EngineState;
  onChange: (next: EngineState) => void;
  errors: Record<string, string>;
}) {
  const phone = usePhone();
  const box = (spec: Spec) => (
    <label key={spec.key} className={`pos-field${errors[spec.key] !== undefined ? ' pos-field--error' : ''}`}>
      <span className="pos-field__label">{t(spec.label)}</span>
      <span className="pos-input-affix pos-settings__hours">
        <input
          className="pos-input pos-input--mono"
          name={spec.key}
          inputMode={spec.kind === 'pct' ? 'numeric' : 'decimal'}
          value={state[spec.key]}
          onChange={(e) => onChange({ ...state, [spec.key]: e.target.value })}
        />
        <span>{t(spec.kind === 'pct' ? 'branches.timing.unit_pct' : 'branches.timing.unit_min')}</span>
      </span>
      {errors[spec.key] !== undefined && <span className="pos-field__error">{errors[spec.key]}</span>}
    </label>
  );
  const group = (title: MessageKey, help: MessageKey, specs: Spec[]) => (
    <div className="pos-stack">
      <div className="pos-section__head pos-section__head--sub">
        <h3>{t(title)}</h3>
        <p>{t(help)}</p>
      </div>
      <div className={phone ? 'pos-stack' : 'pos-grid pos-grid--3'}>{specs.map(box)}</div>
    </div>
  );
  return (
    <section className="pos-section pos-settings" data-group="kitchen-timing">
      <div className="pos-section__head">
        <h2>{t('branches.timing')}</h2>
        <p>{t('branches.timing_help')}</p>
      </div>
      {group('branches.timing.weights', 'branches.timing.weights_help', WEIGHTS)}
      {group('branches.timing.paddings', 'branches.timing.paddings_help', PADDINGS)}
      {group('branches.timing.others', 'branches.timing.others_help', OTHERS)}
      {group('branches.timing.ordering', 'branches.timing.ordering_help', ORDERING)}
      <div className="pos-field" data-field="returns_boost">
        <span className="pos-field__label">{t('branches.timing.returns_boost')}</span>
        <Switch
          checked={state.returns_boost}
          name={t('branches.timing.returns_boost')}
          label={t(state.returns_boost ? 'branches.timing.returns_on' : 'branches.timing.returns_off')}
          onChange={(next) => onChange({ ...state, returns_boost: next })}
        />
        <span className="pos-field__help">{t('branches.timing.returns_help')}</span>
      </div>
      <div className="pos-stack">
        <div className="pos-section__head pos-section__head--sub">
          <h3>{t('branches.timing.kds')}</h3>
          <p>{t('branches.timing.kds_help')}</p>
        </div>
        <div className={phone ? 'pos-stack' : 'pos-grid pos-grid--3'}>
          {KDS.map(box)}
          <div className={`pos-field${errors['served_estimate_ms'] !== undefined ? ' pos-field--error' : ''}`}>
            <label className="pos-field__label" htmlFor="served_estimate_ms">
              {t('branches.timing.served_estimate_ms')}
            </label>
            <span className="pos-input-affix pos-settings__hours">
              <input
                id="served_estimate_ms"
                className="pos-input pos-input--mono"
                name="served_estimate_ms"
                inputMode="decimal"
                disabled={!state.served_estimate_on}
                value={state.served_estimate_ms}
                onChange={(e) => onChange({ ...state, served_estimate_ms: e.target.value })}
              />
              <span>{t('branches.timing.unit_min')}</span>
            </span>
            <Switch
              checked={state.served_estimate_on}
              name={t('branches.timing.served_estimate_switch')}
              label={t(state.served_estimate_on ? 'branches.timing.returns_on' : 'branches.timing.returns_off')}
              onChange={(next) => onChange({ ...state, served_estimate_on: next })}
            />
            <span className="pos-field__help">{t('branches.timing.served_estimate_help')}</span>
            {errors['served_estimate_ms'] !== undefined && <span className="pos-field__error">{errors['served_estimate_ms']}</span>}
          </div>
        </div>
      </div>
    </section>
  );
}
