import { Fragment, useEffect, useReducer, useRef } from 'react';
import { t } from '../../i18n';
import { Ico } from './ui';
import { BASE_GAIN, type AudioSink } from './sounds';
import { timeText } from './labels';
import type { Timers } from './store';

// 01d §3.7 / §8.1 (B05), BF-5: the third line of the tablet brand block. "Alerts: Ali — pauses at 2:05 PM" while the
// hub's deadline is ahead, "Alerts paused" (with one `info` chime) when it passes, "Alerts: none" with no binding.
// The deadline comes from the hub (`alerts_open.binding_route_until`, `binding_route`); the clock is the hub's.

export interface Binding {
  name: string;
  /** hub ms: when the bound tablet stops being a route (§3.4.3 (c)) */
  until: number;
}

export interface BindingHeaderProps {
  binding: Binding | null;
  /** the hub's clock (S47), never the device's */
  nowMs: () => number;
  utcOffsetMs: number;
  timers: Timers;
  sink: AudioSink;
}

/** Splits `Alerts: {name} — pauses at {time}` around its parameters, so the name and the time keep their own marks. */
function active(binding: Binding, utcOffsetMs: number) {
  return t('bind.active')
    .split(/(\{name\}|\{time\})/)
    .map((part, i) => {
      if (part === '{name}') return <b key={i}>{binding.name}</b>;
      if (part === '{time}') return <span key={i} className="num">{timeText(binding.until, utcOffsetMs)}</span>;
      return <Fragment key={i}>{part}</Fragment>;
    });
}

export function BindingHeader({ binding, nowMs, utcOffsetMs, timers, sink }: BindingHeaderProps) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const until = binding?.until ?? null;
  // the chime fires only for a deadline that passes while this header is mounted (never for one already past)
  const sinkRef = useRef(sink);
  sinkRef.current = sink;

  useEffect(() => {
    if (until === null) return;
    const wait = until - nowMs();
    if (wait <= 0) return;
    const handle = timers.setTimeout(() => {
      sinkRef.current.play('info', BASE_GAIN);
      rerender();
    }, wait);
    return () => timers.clearTimeout(handle);
  }, [until, nowMs, timers]);

  const paused = binding !== null && nowMs() >= binding.until;
  if (binding !== null && !paused) {
    return (
      <span className="bind" role="status">
        <Ico name="bell" />
        {active(binding, utcOffsetMs)}
      </span>
    );
  }
  return (
    <span className="bind bind--off" role="status">
      <Ico name="belloff" />
      {binding === null ? t('bind.none') : t('bind.paused')}
    </span>
  );
}
