import { BRANCH_ENGINE_SETTING_KEYS, type BranchEngineSettings } from '@pos/events';
import { Switch } from '../../../components/Switch';
import { fill } from '../../../i18n/en';
import { t, type MessageKey } from '../../../i18n';
import { formatMinutes, parseMinutes } from '../minutes';

// 01a v2.1 §8.1 (A-12), 01b v1.5 B-6: the branch settings page's "Kitchen timing" group. The weights are whole
// percents (sent as typed); every time is typed in minutes and sent as ms (minutes.ts, two decimals, so the
// 15 s and 30 s minimums are 0.25 and 0.5). The ranges are the cloud's (staff.ts BranchEngineSettings); a box
// outside its range is refused here, so the cloud's own check is never the first one the owner meets.
type NumericKey = Exclude<keyof BranchEngineSettings, 'returns_boost'>;
interface Spec {
  key: NumericKey;
  kind: 'pct' | 'ms';
  min: number;
  max: number;
  label: MessageKey;
}
const pct = (key: NumericKey, label: MessageKey): Spec => ({ key, kind: 'pct', min: 10, max: 1000, label });
const pad = (key: NumericKey, label: MessageKey): Spec => ({ key, kind: 'ms', min: 0, max: 1_800_000, label });

export const WEIGHTS: Spec[] = [
  pct('weight_dine_in_pct', 'branches.timing.weight_dine_in_pct'),
  pct('weight_takeaway_pct', 'branches.timing.weight_takeaway_pct'),
  pct('weight_delivery_pct', 'branches.timing.weight_delivery_pct'),
  pct('weight_parking_pct', 'branches.timing.weight_parking_pct'),
  pct('weight_follow_up_pct', 'branches.timing.weight_follow_up_pct'),
];
export const PADDINGS: Spec[] = [
  pad('promise_padding_dine_in_ms', 'branches.timing.promise_padding_dine_in_ms'),
  pad('promise_padding_takeaway_ms', 'branches.timing.promise_padding_takeaway_ms'),
  pad('promise_padding_delivery_ms', 'branches.timing.promise_padding_delivery_ms'),
  pad('promise_padding_parking_ms', 'branches.timing.promise_padding_parking_ms'),
];
export const OTHERS: Spec[] = [
  { key: 'slip_threshold_ms', kind: 'ms', min: 60_000, max: 1_800_000, label: 'branches.timing.slip_threshold_ms' },
  { key: 'slip_escalate_ms', kind: 'ms', min: 30_000, max: 1_800_000, label: 'branches.timing.slip_escalate_ms' },
  { key: 'cascade_step_ms', kind: 'ms', min: 15_000, max: 300_000, label: 'branches.timing.cascade_step_ms' },
  { key: 'min_gain_ms', kind: 'ms', min: 0, max: 600_000, label: 'branches.timing.min_gain_ms' },
  { key: 'table_lock_ttl_ms', kind: 'ms', min: 60_000, max: 3_600_000, label: 'branches.timing.table_lock_ttl_ms' },
  { key: 'order_abandon_ms', kind: 'ms', min: 3_600_000, max: 86_400_000, label: 'branches.timing.order_abandon_ms' },
];
const SPECS: Spec[] = [...WEIGHTS, ...PADDINGS, ...OTHERS];

export type EngineState = Record<NumericKey, string> & { returns_boost: boolean };

export function engineState(base: BranchEngineSettings): EngineState {
  const state = { returns_boost: base.returns_boost } as EngineState;
  for (const spec of SPECS) state[spec.key] = spec.kind === 'pct' ? String(base[spec.key]) : formatMinutes(base[spec.key]);
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
  const patch: Record<string, number | boolean> = {};
  const errors: Record<string, string> = {};
  for (const spec of SPECS) {
    const value = valueOf(spec, state[spec.key], base[spec.key]);
    if (value === null || value < spec.min || value > spec.max) {
      errors[spec.key] =
        spec.kind === 'pct'
          ? fill(t('branches.timing_pct_range'), { min: String(spec.min), max: String(spec.max) })
          : fill(t('branches.timing_minutes_range'), { min: formatMinutes(spec.min), max: formatMinutes(spec.max) });
    } else if (value !== base[spec.key]) patch[spec.key] = value;
  }
  if (state.returns_boost !== base.returns_boost) patch['returns_boost'] = state.returns_boost;
  return { patch: patch as Partial<BranchEngineSettings>, errors };
}

export const engineFieldLabel = (key: string): string | undefined => {
  if (key === 'returns_boost') return t('branches.timing.returns_boost');
  const spec = SPECS.find((s) => s.key === key);
  return spec === undefined ? undefined : t(spec.label);
};
export const isEngineKey = (key: string): boolean => (BRANCH_ENGINE_SETTING_KEYS as string[]).includes(key);

export function KitchenTiming({
  state,
  onChange,
  errors,
}: {
  state: EngineState;
  onChange: (next: EngineState) => void;
  errors: Record<string, string>;
}) {
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
      <div className="pos-grid pos-grid--3">{specs.map(box)}</div>
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
      <div className="pos-field">
        <span className="pos-field__label">{t('branches.timing.returns_boost')}</span>
        <Switch
          checked={state.returns_boost}
          name={t('branches.timing.returns_boost')}
          label={t(state.returns_boost ? 'branches.timing.returns_on' : 'branches.timing.returns_off')}
          onChange={(next) => onChange({ ...state, returns_boost: next })}
        />
        <span className="pos-field__help">{t('branches.timing.returns_help')}</span>
      </div>
    </section>
  );
}
