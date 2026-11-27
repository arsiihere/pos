import { useState } from 'react';
import { t, type MessageKey } from '../../../../i18n';
import { timeText } from '../../../alerts/labels';
import { Ico } from '../../../alerts/ui';
import { chipPickup, PICKUP_CHIPS, pickupProblemText, pickupRangeText, timeInputOf, timePickup, type CartPickup, type PickupBounds, type PickupProblem } from './pickup';

// ⚠️ 02b-TK L-CLIENT-5 item 1 (02b v1.0.25 §8 "Phone and pickup" (R1, R4), §6.14; frames PickupLater, PickupLaterUrdu;
// MAPPING TK-D02 `.tk-pick`): the takeaway cart's pickup row under the customer — Now (no pickup, the default) / +15 /
// +30 / +45 min after hub now / Time… (a time input, its range the hub's `pickup_bounds` from eta-preview, shown as
// "Pickup between 1:30 PM and 4:00 AM"). A preview refused 422 PICKUP_TIME_INVALID shows the reason and the range.
// Name and phone stay optional with a pickup (R1 overrules the frame's "needed for later pickup"). No CSS of its own:
// the ServeChoice band (`.tk-serve .tk-pick`, packages/ui-kit staff-02b-tk.css) carries the chips.

const CHIP_KEY: Record<(typeof PICKUP_CHIPS)[number], MessageKey> = { 15: 'c.pick_15', 30: 'c.pick_30', 45: 'c.pick_45' };

export interface PickupRowProps {
  value: CartPickup | undefined;
  /** hub-clock now (ms) */
  nowMs(): number;
  utcOffsetMs: number;
  /** the last preview's range (null until one came) */
  bounds: PickupBounds | null;
  /** the preview's PICKUP_TIME_INVALID, or null */
  problem: PickupProblem | null;
  disabled: boolean;
  onChange(next: CartPickup | undefined): void;
}

export function PickupRow({ value, nowMs, utcOffsetMs, bounds, problem, disabled, onChange }: PickupRowProps) {
  const [typing, setTyping] = useState(false);
  const timeOpen = typing || value?.chip === 'time';
  const range = problem ?? bounds;
  const press = (on: boolean) => ({ 'aria-pressed': on, className: on ? 'is-sel' : undefined });
  return (
    <div className="tk-serve" role="group" aria-label={t('c.pickup')} data-pickup-row="">
      <b>
        <Ico name="clock" /> {t('c.pickup')}
      </b>
      <div className="tk-pick">
        <button
          type="button"
          {...press(value === undefined && !typing)}
          disabled={disabled}
          onClick={() => {
            setTyping(false);
            onChange(undefined);
          }}
        >
          {t('c.pick_now')}
        </button>
        {PICKUP_CHIPS.map((n) => (
          <button
            key={n}
            type="button"
            {...press(value?.chip === n)}
            disabled={disabled}
            onClick={() => {
              setTyping(false);
              onChange(chipPickup(nowMs(), n));
            }}
          >
            {t(CHIP_KEY[n])}
          </button>
        ))}
        <button type="button" {...press(timeOpen)} disabled={disabled} onClick={() => setTyping(true)}>
          {value?.chip === 'time' ? (
            <span className="time" dir="ltr">
              {timeText(value.at_ms, utcOffsetMs)}
            </span>
          ) : (
            t('c.pick_time')
          )}
        </button>
      </div>
      {timeOpen && (
        <label className="fld">
          <input
            className="inp num"
            type="time"
            dir="ltr"
            aria-label={t('c.pick_time')}
            disabled={disabled}
            {...(range === null ? {} : { min: timeInputOf(range.earliest_ms, utcOffsetMs), max: timeInputOf(range.latest_ms, utcOffsetMs) })}
            value={value?.chip === 'time' ? timeInputOf(value.at_ms, utcOffsetMs) : ''}
            onChange={(e) => {
              const next = timePickup(e.target.value, nowMs(), utcOffsetMs);
              if (next !== null) onChange(next);
            }}
          />
          {range !== null && problem === null && <small className="muted">{pickupRangeText(range, utcOffsetMs)}</small>}
        </label>
      )}
      {problem !== null && (
        <span className="fld__e" role="alert" data-pickup-problem="">
          <Ico name="warn" />
          <span>
            {pickupProblemText(problem, utcOffsetMs)} · {pickupRangeText(problem, utcOffsetMs)}
          </span>
        </span>
      )}
    </div>
  );
}
