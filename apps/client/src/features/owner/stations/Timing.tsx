import type { PatchStationBody, Point, Station, StationType } from '../../../api/cloud-admin';
import { Switch } from '../../../components/Switch';
import { fill } from '../../../i18n/en';
import { t, type MessageKey } from '../../../i18n';
import { formatMinutes, parseMinutes } from '../minutes';

// §8.1 (03a D1; 01a §5.2a A-2–A-10): the station form's "Timing" group. Times are typed in minutes and sent as
// ms (minutes.ts); the pressure thresholds are typed as a percent of the window and sent as basis points. The
// ranges are the cloud's: a refused value shows the server's message under its field. Alternates (A-9) offer
// only the branch's other active slot stations; carry times (A-10) are one minutes box per point, empty = 0.
export type Policy = Station['policy'];
export type OrderType = Station['alternates'][number]['order_types'][number];
export const ORDER_TYPES: readonly OrderType[] = ['dine_in', 'takeaway', 'delivery', 'parking'];
export const POLICIES: readonly Policy[] = ['waada_guard', 'edf', 'fifo'];

export const DEFAULTS = {
  policy: 'waada_guard',
  freeze_ms: 120_000,
  min_slack_keep_ms: 60_000,
  promise_padding_ms: null,
  pressure_window_ms: 900_000,
  pressure_amber_bp: 8_000,
  pressure_red_bp: 10_000,
  pressure_alert_ms: 300_000,
  pause_enabled: false,
  lane_units: null,
  reserve_units: 0,
} as const;

type Alternate = Station['alternates'][number];
export type AlternateRow = { id: string; order_types: OrderType[]; home: OrderType[] };

export interface TimingState {
  point_id: string;
  policy: Policy;
  freeze: string;
  slack: string;
  padding: string;
  window: string;
  amber: string;
  red: string;
  alert: string;
  pause: boolean;
  lane: string;
  reserve: string;
  alternates: AlternateRow[];
  carry: Record<string, string>;
}

const WHOLE_RE = /^[0-9]+$/;
const parseWhole = (text: string): number | null => (WHOLE_RE.test(text.trim()) ? Number(text.trim()) : null);
const BP_RE = /^[0-9]+(\.[0-9]{1,2})?$/;
const parsePercentBp = (text: string): number | null => (BP_RE.test(text.trim()) ? Math.round(Number(text.trim()) * 100) : null);
const formatBp = (bp: number): string => String(Math.round(bp) / 100);

export type StationFields = Pick<
  Station,
  | 'point_id'
  | 'policy'
  | 'freeze_ms'
  | 'min_slack_keep_ms'
  | 'promise_padding_ms'
  | 'pressure_window_ms'
  | 'pressure_amber_bp'
  | 'pressure_red_bp'
  | 'pressure_alert_ms'
  | 'pause_enabled'
  | 'lane_units'
  | 'reserve_units'
  | 'alternates'
  | 'carry_times'
>;

// Rows naming a station that is not an offered one (archived since, CL-10) are dropped from the form.
export function timingState(base: StationFields, offered: ReadonlySet<string>): TimingState {
  return {
    point_id: base.point_id,
    policy: base.policy,
    freeze: formatMinutes(base.freeze_ms),
    slack: formatMinutes(base.min_slack_keep_ms),
    padding: base.promise_padding_ms === null ? '' : formatMinutes(base.promise_padding_ms),
    window: formatMinutes(base.pressure_window_ms),
    amber: formatBp(base.pressure_amber_bp),
    red: formatBp(base.pressure_red_bp),
    alert: formatMinutes(base.pressure_alert_ms),
    pause: base.pause_enabled,
    lane: base.lane_units === null ? '' : String(base.lane_units),
    reserve: String(base.reserve_units),
    alternates: base.alternates
      .filter((row) => offered.has(row.alternate_station_id))
      .map((row) => ({ id: row.alternate_station_id, order_types: [...row.order_types], home: [...row.home_for_order_types] })),
    carry: Object.fromEntries(base.carry_times.filter((row) => row.carry_ms > 0).map((row) => [row.point_id, formatMinutes(row.carry_ms)])),
  };
}

const inOrder = (types: readonly OrderType[]) => ORDER_TYPES.filter((type) => types.includes(type));

function normaliseAlternates(rows: readonly Alternate[]): Alternate[] {
  return rows
    .map((row) => ({
      alternate_station_id: row.alternate_station_id,
      order_types: inOrder(row.order_types),
      home_for_order_types: inOrder(row.home_for_order_types),
    }))
    .sort((a, b) => (a.alternate_station_id < b.alternate_station_id ? -1 : 1));
}

function normaliseCarry(rows: Station['carry_times']): Station['carry_times'] {
  return rows.filter((row) => row.carry_ms > 0).sort((a, b) => (a.point_id < b.point_id ? -1 : 1));
}

const FIELD_OF: [keyof PatchStationBody, MessageKey][] = [
  ['point_id', 'owner.stations.field.point_id'],
  ['policy', 'owner.stations.field.policy'],
  ['freeze_ms', 'owner.stations.field.freeze_ms'],
  ['min_slack_keep_ms', 'owner.stations.field.min_slack_keep_ms'],
  ['promise_padding_ms', 'owner.stations.field.promise_padding_ms'],
  ['pressure_window_ms', 'owner.stations.field.pressure_window_ms'],
  ['pressure_amber_bp', 'owner.stations.field.pressure_amber_bp'],
  ['pressure_red_bp', 'owner.stations.field.pressure_red_bp'],
  ['pressure_alert_ms', 'owner.stations.field.pressure_alert_ms'],
  ['pause_enabled', 'owner.stations.field.pause_enabled'],
  ['lane_units', 'owner.stations.field.lane_units'],
  ['reserve_units', 'owner.stations.field.reserve_units'],
  ['alternates', 'owner.stations.field.alternates'],
  ['carry_times', 'owner.stations.field.carry_times'],
];
export const timingFieldLabel = (field: string): MessageKey | undefined => FIELD_OF.find(([name]) => name === field)?.[1];

// The fields of the state that differ from `base`, ready for a PATCH (or, for a new station, the non-default
// ones for the POST). `null` when a box does not hold a number the cloud could range-check.
export function timingPatch(
  state: TimingState,
  base: StationFields,
  type: StationType,
  offered: ReadonlySet<string>,
): Pick<PatchStationBody, 'point_id' | 'policy' | 'freeze_ms' | 'min_slack_keep_ms' | 'promise_padding_ms' | 'pressure_window_ms' | 'pressure_amber_bp' | 'pressure_red_bp' | 'pressure_alert_ms' | 'pause_enabled' | 'lane_units' | 'reserve_units' | 'alternates' | 'carry_times'> | null {
  const freeze = parseMinutes(state.freeze);
  const slack = parseMinutes(state.slack);
  const padding = state.padding.trim() === '' ? null : parseMinutes(state.padding);
  const window = parseMinutes(state.window);
  const amber = parsePercentBp(state.amber);
  const red = parsePercentBp(state.red);
  const alert = parseMinutes(state.alert);
  const lane = state.lane.trim() === '' ? null : parseWhole(state.lane);
  const reserve = parseWhole(state.reserve);
  if (
    freeze === null || slack === null || (state.padding.trim() !== '' && padding === null) || window === null || amber === null ||
    red === null || alert === null || (state.lane.trim() !== '' && lane === null) || reserve === null
  ) {
    return null;
  }
  const carryRows: Station['carry_times'] = [];
  for (const [point_id, text] of Object.entries(state.carry)) {
    if (text.trim() === '') continue;
    const carry_ms = parseMinutes(text);
    if (carry_ms === null) return null;
    carryRows.push({ point_id, carry_ms });
  }
  const out: ReturnType<typeof timingPatch> & object = {};
  if (state.point_id !== '' && state.point_id !== base.point_id) out.point_id = state.point_id;
  if (state.policy !== base.policy) out.policy = state.policy;
  if (freeze !== base.freeze_ms) out.freeze_ms = freeze;
  if (slack !== base.min_slack_keep_ms) out.min_slack_keep_ms = slack;
  if (padding !== base.promise_padding_ms) out.promise_padding_ms = padding;
  if (window !== base.pressure_window_ms) out.pressure_window_ms = window;
  if (amber !== base.pressure_amber_bp) out.pressure_amber_bp = amber;
  if (red !== base.pressure_red_bp) out.pressure_red_bp = red;
  if (alert !== base.pressure_alert_ms) out.pressure_alert_ms = alert;
  if (state.pause !== base.pause_enabled) out.pause_enabled = state.pause;
  if (lane !== base.lane_units) out.lane_units = lane;
  if (reserve !== base.reserve_units) out.reserve_units = reserve;
  // A batch station takes no alternates (A-9): leaving slot clears the list.
  const rows = type === 'slot'
    ? state.alternates.filter((row) => offered.has(row.id)).map((row) => ({ alternate_station_id: row.id, order_types: row.order_types, home_for_order_types: row.home }))
    : [];
  if (!sameAlternates(rows, base.alternates)) out.alternates = rows;
  if (JSON.stringify(normaliseCarry(carryRows)) !== JSON.stringify(normaliseCarry(base.carry_times))) out.carry_times = carryRows.filter((row) => row.carry_ms > 0);
  return out;
}

function sameAlternates(a: readonly Alternate[], b: readonly Alternate[]): boolean {
  return JSON.stringify(normaliseAlternates(a)) === JSON.stringify(normaliseAlternates(b));
}

const ORDER_LABEL: Record<OrderType, MessageKey> = {
  dine_in: 'owner.stations.order.dine_in',
  takeaway: 'owner.stations.order.takeaway',
  delivery: 'owner.stations.order.delivery',
  parking: 'owner.stations.order.parking',
};
const POLICY_LABEL: Record<Policy, MessageKey> = {
  waada_guard: 'owner.stations.policy.waada_guard',
  edf: 'owner.stations.policy.edf',
  fifo: 'owner.stations.policy.fifo',
};

export interface OfferedStation {
  station_id: string;
  name: string;
}

export function TimingFields({
  state,
  onChange,
  type,
  points,
  offered,
  issues,
  newStation = false,
  currentPointId,
}: {
  state: TimingState;
  onChange: (next: TimingState) => void;
  type: StationType;
  points: readonly Point[];
  offered: readonly OfferedStation[];
  issues: Record<string, string>;
  newStation?: boolean;
  currentPointId: string;
}) {
  const set = (patch: Partial<TimingState>) => onChange({ ...state, ...patch });
  const pointChoices = points.filter((p) => p.archived_at === null || p.point_id === currentPointId);
  const carryPoints = points.filter((p) => p.archived_at === null || (state.carry[p.point_id] ?? '') !== '');
  const text = (name: keyof TimingState & string, field: string, label: MessageKey, mode: 'numeric' | 'decimal', help?: MessageKey, placeholder?: string) => (
    <label className={`pos-field${issues[field] !== undefined ? ' pos-field--error' : ''}`}>
      <span className="pos-field__label">{t(label)}</span>
      <input
        className="pos-input pos-input--mono"
        name={name}
        inputMode={mode}
        placeholder={placeholder}
        value={String(state[name])}
        onChange={(e) => set({ [name]: e.target.value } as Partial<TimingState>)}
      />
      {issues[field] !== undefined ? <span className="pos-field__help">{issues[field]}</span> : help !== undefined && <span className="pos-field__help">{t(help)}</span>}
    </label>
  );
  const free = offered.filter((s) => !state.alternates.some((row) => row.id === s.station_id));
  const nameOf = (id: string) => offered.find((s) => s.station_id === id)?.name ?? id;
  const setRow = (id: string, patch: Partial<AlternateRow>) =>
    set({ alternates: state.alternates.map((row) => (row.id === id ? { ...row, ...patch } : row)) });
  const toggle = (list: OrderType[], ot: OrderType) => (list.includes(ot) ? list.filter((x) => x !== ot) : [...list, ot]);

  return (
    <div className="pos-stack" data-group="timing">
      <div className="pos-section__head pos-section__head--sub">
        <h3>{t('owner.stations.timing')}</h3>
        <p>{t('owner.stations.timing_body')}</p>
      </div>
      <div className="pos-grid pos-grid--3">
        <label className={`pos-field${issues['point_id'] !== undefined ? ' pos-field--error' : ''}`}>
          <span className="pos-field__label">{t('owner.stations.point')}</span>
          <select className="pos-select" name="point_id" value={state.point_id} onChange={(e) => set({ point_id: e.target.value })}>
            {newStation && <option value="">{t('owner.stations.point_default')}</option>}
            {pointChoices.map((p) => (
              <option key={p.point_id} value={p.point_id}>
                {p.name}
              </option>
            ))}
          </select>
          {issues['point_id'] !== undefined && <span className="pos-field__help">{issues['point_id']}</span>}
        </label>
        <label className="pos-field">
          <span className="pos-field__label">{t('owner.stations.policy')}</span>
          <select className="pos-select" name="policy" value={state.policy} onChange={(e) => set({ policy: e.target.value as Policy })}>
            {POLICIES.map((policy) => (
              <option key={policy} value={policy}>
                {t(POLICY_LABEL[policy])}
              </option>
            ))}
          </select>
        </label>
        {text('freeze', 'freeze_ms', 'owner.stations.freeze', 'decimal', 'owner.stations.freeze_help')}
        {text('slack', 'min_slack_keep_ms', 'owner.stations.min_slack', 'decimal', 'owner.stations.min_slack_help')}
        {text('padding', 'promise_padding_ms', 'owner.stations.padding', 'decimal', 'owner.stations.padding_help', t('owner.stations.padding_branch'))}
        {text('window', 'pressure_window_ms', 'owner.stations.pressure_window', 'decimal')}
        {text('amber', 'pressure_amber_bp', 'owner.stations.pressure_amber', 'decimal', 'owner.stations.pressure_help')}
        {text('red', 'pressure_red_bp', 'owner.stations.pressure_red', 'decimal')}
        {text('alert', 'pressure_alert_ms', 'owner.stations.pressure_alert', 'decimal')}
        {text('lane', 'lane_units', 'owner.stations.lane_units', 'numeric', 'owner.stations.lane_help', t('owner.stations.lane_auto'))}
        {text('reserve', 'reserve_units', 'owner.stations.reserve_units', 'numeric', 'owner.stations.reserve_help')}
      </div>
      <div className="pos-field">
        <Switch
          checked={state.pause}
          name={t('owner.stations.pause')}
          label={t(state.pause ? 'owner.stations.pause_on' : 'owner.stations.pause_off')}
          onChange={(next) => set({ pause: next })}
        />
        <span className="pos-field__help">{t('owner.stations.pause_help')}</span>
      </div>

      {type === 'slot' && (
        <div className="pos-stack" data-group="alternates">
          <div className="pos-section__head pos-section__head--sub">
            <h3>{t('owner.stations.alternates')}</h3>
            <p>{t('owner.stations.alternates_body')}</p>
          </div>
          {issues['alternates'] !== undefined && <span className="pos-field__help">{issues['alternates']}</span>}
          {state.alternates.map((row) => (
            <div key={row.id} className="pos-card pos-stack" data-alternate-id={row.id}>
              <div className="pos-row">
                <strong>{nameOf(row.id)}</strong>
                <button
                  type="button"
                  className="pos-btn"
                  aria-label={fill(t('owner.stations.alternate_remove'), { name: nameOf(row.id) })}
                  onClick={() => set({ alternates: state.alternates.filter((x) => x.id !== row.id) })}
                >
                  {t('owner.stations.remove')}
                </button>
              </div>
              <div className="pos-row" role="group" aria-label={t('owner.stations.alternate_serves')}>
                <span className="pos-field__label">{t('owner.stations.alternate_serves')}</span>
                {ORDER_TYPES.map((ot) => (
                  <button
                    key={ot}
                    type="button"
                    role="checkbox"
                    aria-checked={row.order_types.includes(ot)}
                    data-order-type={ot}
                    className={`pos-tick${row.order_types.includes(ot) ? ' is-on' : ''}`}
                    onClick={() => {
                      const order_types = toggle(row.order_types, ot);
                      setRow(row.id, { order_types, home: row.home.filter((h) => order_types.includes(h)) });
                    }}
                  >
                    <i />
                    {t(ORDER_LABEL[ot])}
                  </button>
                ))}
              </div>
              <div className="pos-row" role="group" aria-label={t('owner.stations.alternate_home')}>
                <span className="pos-field__label">{t('owner.stations.alternate_home')}</span>
                {ORDER_TYPES.filter((ot) => row.order_types.includes(ot)).map((ot) => (
                  <button
                    key={ot}
                    type="button"
                    role="checkbox"
                    aria-checked={row.home.includes(ot)}
                    data-home-type={ot}
                    className={`pos-tick${row.home.includes(ot) ? ' is-on' : ''}`}
                    onClick={() => setRow(row.id, { home: toggle(row.home, ot) })}
                  >
                    <i />
                    {t(ORDER_LABEL[ot])}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {free.length > 0 ? (
            <label className="pos-field">
              <span className="pos-field__label">{t('owner.stations.alternate_add')}</span>
              <select
                className="pos-select"
                name="alternate_add"
                value=""
                onChange={(e) => {
                  if (e.target.value !== '') {
                    set({ alternates: [...state.alternates, { id: e.target.value, order_types: [...ORDER_TYPES], home: [] }] });
                  }
                }}
              >
                <option value="">{t('owner.stations.alternate_pick')}</option>
                {free.map((s) => (
                  <option key={s.station_id} value={s.station_id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            state.alternates.length === 0 && <p className="pos-field__help">{t('owner.stations.alternate_none')}</p>
          )}
        </div>
      )}

      <div className="pos-stack" data-group="carry-times">
        <div className="pos-section__head pos-section__head--sub">
          <h3>{t('owner.stations.carry_times')}</h3>
          <p>{t('owner.stations.carry_body')}</p>
        </div>
        {issues['carry_times'] !== undefined && <span className="pos-field__help">{issues['carry_times']}</span>}
        <div className="pos-grid pos-grid--3">
          {carryPoints.map((p) => (
            <label key={p.point_id} className="pos-field" data-carry-point={p.point_id}>
              <span className="pos-field__label">{fill(t('owner.stations.carry_to'), { point: p.name })}</span>
              <input
                className="pos-input pos-input--mono"
                name={`carry_${p.point_id}`}
                inputMode="decimal"
                placeholder="0"
                value={state.carry[p.point_id] ?? ''}
                onChange={(e) => set({ carry: { ...state.carry, [p.point_id]: e.target.value } })}
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
