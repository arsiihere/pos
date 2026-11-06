import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { formatMinutes, parseMinutes } from '../minutes';

// 01a v2.1 §8.1 (A-11): the item's five timing knobs. The weight is a whole percent; the times are typed in
// minutes and sent as ms. max_carry and max_late are empty = no limit (null). Ranges are the cloud's
// (restaurant.ts), so a refusal here reads the same as the cloud's.
export interface Knob {
  name: 'max_early_ms' | 'max_carry_ms' | 'max_late_ms' | 'adjust_time_ms';
  min: number;
  max: number;
  nullable: boolean;
}
export const WEIGHT_RANGE = { min: 10, max: 1000 } as const;
export const KNOBS: readonly Knob[] = [
  { name: 'max_early_ms', min: 0, max: 3_600_000, nullable: false },
  { name: 'max_carry_ms', min: 0, max: 600_000, nullable: true },
  { name: 'max_late_ms', min: 0, max: 7_200_000, nullable: true },
  { name: 'adjust_time_ms', min: 0, max: 3_600_000, nullable: false },
];

export const knobText = (ms: number | null): string => (ms === null ? '' : formatMinutes(ms));

// undefined = the box does not hold a value in range. A box left as stored keeps its exact stored ms, which
// two-decimal minutes may not round-trip.
export function knobValue(knob: Knob, text: string, stored: number | null | undefined): number | null | undefined {
  if (text.trim() === '') return knob.nullable ? null : undefined;
  const ms = stored != null && text === formatMinutes(stored) ? stored : parseMinutes(text);
  return ms === null || ms < knob.min || ms > knob.max ? undefined : ms;
}

export function weightValue(text: string): number | undefined {
  const n = /^[0-9]+$/.test(text.trim()) ? Number(text.trim()) : NaN;
  return n >= WEIGHT_RANGE.min && n <= WEIGHT_RANGE.max ? n : undefined;
}

export const rangeText = (knob: Knob): string =>
  fill(t('item.timing.need_minutes'), { min: formatMinutes(knob.min), max: formatMinutes(knob.max) });
