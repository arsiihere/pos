import { useState } from 'react';
import { t } from '../../../../i18n';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';
import type { Permissions } from '../../shell/permissions';

// 02b-B11 OrderDayNotStarted (02b §8 Queue, §10 #36; owner ruling Q-20): Send answered BUSINESS_DAY_NOT_OPEN. The
// cart is kept.
// ⚠️ 02b v1.0.28 QR2-2 (owner 2026-11-28 QA-R2, BUG-9): Start day is on the staff app — a `close-business-day` holder
// (the permission of Close day) gets a Start day button that sends `OpenBusinessDay {}` here; a `manage-stock` holder at
// `branch` without it keeps the hub admin page /admin/stock/ (Q-20); everyone else is asked to get the manager.

export const START_DAY_HREF = '/admin/stock/';

/** 'staff': Start day sends OpenBusinessDay from this app; 'admin': the /admin/stock/ link; null: ask the manager. */
export type StartDayMode = 'staff' | 'admin' | null;

export function startDayMode(permissions: Permissions): StartDayMode {
  if (permissions.allowed('close-business-day')) return 'staff';
  if (permissions.allowed('manage-stock') && permissions.scope('manage-stock') === 'branch') return 'admin';
  return null;
}

/** QR2-2: sends `OpenBusinessDay {}` on the staff route; the BusinessDayOpened frame then ends every "day not started". */
export function StartDayButton({ className }: { className: string }) {
  const shell = useShell();
  const [busy, setBusy] = useState(false);
  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const answer = await shell.api.command<{ changed: boolean }>('OpenBusinessDay', {});
      if (answer.ok) shell.toasts.show({ text: t('day.started'), tone: 'ok' });
      else shell.toasts.show({ text: answer.error.kind === 'api' ? t('day.start_failed') : t('tables.toast.needs_hub'), tone: 'warn' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={className} disabled={busy} aria-busy={busy || undefined} onClick={() => void start()}>
      {t('day.start')}
    </button>
  );
}

/** The Start day control of `mode` (none for null). */
export function StartDay({ mode, staffClass, linkClass }: { mode: StartDayMode; staffClass: string; linkClass: string }) {
  if (mode === 'staff') return <StartDayButton className={staffClass} />;
  if (mode === 'admin')
    return (
      <a className={linkClass} href={START_DAY_HREF}>
        {t('day.start')}
      </a>
    );
  return null;
}

export function DayNotStarted({ mode }: { mode: StartDayMode }) {
  return (
    <div className="day">
      <div className="msg c-warn" role="alert">
        <Ico name="warn" />
        <span>{t('day.not_started')}</span>
      </div>
      {mode !== null ? (
        <StartDay mode={mode} staffClass="btn btn--primary btn--lg btn--block" linkClass="btn btn--primary btn--lg btn--block" />
      ) : (
        <>
          <p className="muted">{t('day.ask_manager')}</p>
          <button type="button" className="btn btn--primary btn--lg btn--block" disabled>
            <Ico name="send" />
            {t('cart.send')}
          </button>
        </>
      )}
    </div>
  );
}
