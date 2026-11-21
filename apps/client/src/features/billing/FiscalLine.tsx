import { useCallback, useEffect, useMemo, useState } from 'react';
import { t } from '../../i18n';
import { fill } from '../../i18n/en';
import { timeText } from '../alerts/labels';
import { dayStart, shortDayText } from '../audit/days';
import { Ico } from '../alerts/ui';
import { useLiveRefetch } from '../staff/orders/lists/OpenOrders';
import { useShell } from '../staff/shell/hooks';
import { billingApi } from './api';
import type { FiscalStatusView } from './contracts';
import { BILL_LIST_FRAMES } from './frames';
import { durationText } from './money';

// 05 v1.0.24 §8 "Reports" (the fiscal status line on the cashier screen when the adapter is not `none`), §6.27 (plan
// §4.1 task 42; frame OpenBillsFiscal). No action for a cashier (Retry fiscal now is on the X); never a token or a
// pos id. Read on mount and on the bill frames the open-bills list reads on (an invoice issued, a fiscal number, a
// rejection) and on reconnect.

export type FiscalTone = 'c-ok' | 'c-info' | 'c-warn' | 'c-danger' | 'c-mute';

/** The line for a status, worst first (frame OpenBillsFiscal); null for the adapter `none`. */
export function fiscalLineOf(s: FiscalStatusView, utcOffsetMs: number, nowMs?: number): { tone: FiscalTone; text: string; small?: string } | null {
  if (s.adapter_key === 'none') return null;
  const waiting = () =>
    fill(t('billing.fiscal.waiting'), { count: String(s.pending_count), age: durationText(Math.floor((s.oldest_pending_age_ms ?? 0) / 60_000)) });
  if (s.token_missing.length > 0) return { tone: 'c-danger', text: t('billing.fiscal.not_set_up') };
  if (s.rejected_count > 0) return { tone: 'c-danger', text: fill(t('billing.fiscal.rejected'), { count: String(s.rejected_count) }) };
  if (s.adapter_health === 'failing') return { tone: 'c-warn', text: t('billing.fiscal.failing') };
  if (s.stuck && s.pending_count > 0) return { tone: 'c-warn', text: fill(t('billing.fiscal.stuck'), { waiting: waiting() }) };
  if (s.pending_count > 0) return { tone: 'c-info', text: waiting() };
  if (s.adapter_health === 'unknown') return { tone: 'c-mute', text: t('billing.fiscal.unknown') };
  // frame: "Fiscal: all sent" with "last 1:38 PM" as its small end note
  if (s.last_success_at === null) return { tone: 'c-ok', text: t('billing.fiscal.all_sent') };
  // an ack of an earlier day names its date (review m7: a quiet night never reads as today's time)
  const when = nowMs !== undefined && dayStart(s.last_success_at, utcOffsetMs) !== dayStart(nowMs, utcOffsetMs) ? `${shortDayText(s.last_success_at, utcOffsetMs)} ${timeText(s.last_success_at, utcOffsetMs)}` : timeText(s.last_success_at, utcOffsetMs);
  return { tone: 'c-ok', text: t('billing.fiscal.all_sent'), small: fill(t('billing.fiscal.last'), { time: when }) };
}

export const REFRESH_MS = 60_000;

const ICON = { 'c-ok': 'checkc', 'c-info': 'sync', 'c-warn': 'warn', 'c-danger': 'warn', 'c-mute': 'info' } as const;

export function FiscalLine() {
  const shell = useShell();
  const api = useMemo(() => billingApi(shell.api), [shell.api]);
  const [status, setStatus] = useState<FiscalStatusView | null>(null);
  const load = useCallback(async () => {
    const answer = await api.fiscalStatus();
    // a refusal or the hub down keeps the last line (or none): the line never blocks the list
    if (answer.ok) setStatus(answer.data);
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefetch(shell.live, () => void load(), BILL_LIST_FRAMES);
  // the oldest age, stuck and the adapter's health move with time and the worker, not with a frame: read each minute
  useEffect(() => {
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);
  const line = status === null ? null : fiscalLineOf(status, shell.clock.utcOffsetMs, shell.clock.nowMs());
  if (line === null) return null;
  return (
    <div className={`b5-fis ${line.tone}`} role="status">
      <Ico name={ICON[line.tone]} />
      <span>{line.text}</span>
      {line.small !== undefined && <small>{line.small}</small>}
    </div>
  );
}
