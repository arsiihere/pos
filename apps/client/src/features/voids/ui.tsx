import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { VoidBlock, VoidDisposition } from '@pos/domain';
import { t, type MessageKey } from '../../i18n';
import { Ico, type IconName } from '../alerts/ui';
import { useShell } from '../staff/shell/hooks';
import type { Outcome } from './model';
import { VIco, type VoidIconName } from './icons';

// 04 §8 shared parts of the void screens (handoff 04 VoidParts): the dialog frame (centred dialog; bottom sheet on
// a phone or a portrait tablet), the inline message, the disposition and outcome words and icons.

export type MsgTone = 'danger' | 'warn' | 'ok' | 'info';

/** 01d `.msg` with a second line and an optional button inside (VoidWrongStage "Remove"). */
export function VoidMsg({ tone, text, hint, icon = 'warn', action }: { tone: MsgTone; text: string; hint?: string | undefined; icon?: IconName; action?: ReactNode }) {
  return (
    <div className={`msg c-${tone}`} role="alert">
      <Ico name={icon} />
      <div>
        {text}
        {hint !== undefined && <small>{hint}</small>}
      </div>
      {action}
    </div>
  );
}

export const DISPOSITION_KEY: Record<VoidDisposition, { label: MessageKey; hint: MessageKey; icon: VoidIconName; tone: string }> = {
  moved: { label: 'void.disposition.moved', hint: 'void.disposition.moved.hint', icon: 'stock', tone: 'ok' },
  wastage: { label: 'void.disposition.wastage', hint: 'void.disposition.wastage.hint', icon: 'wastage', tone: 'danger' },
  staff_meal: { label: 'void.disposition.staff_meal', hint: 'void.disposition.staff_meal.hint', icon: 'meal', tone: 'brand' },
  other: { label: 'void.disposition.other', hint: 'void.disposition.other.hint', icon: 'dots', tone: 'mute' },
};

export const BLOCK_KEY: Record<VoidBlock, MessageKey> = {
  stock_not_tracked: 'void.block.stock_not_tracked',
  not_movable_stage: 'void.block.not_movable_stage',
  move_not_granted: 'void.block.move_not_granted',
  day_closed: 'void.block.day_closed',
};

const OUTCOME: Record<Outcome, { key: MessageKey; icon: VoidIconName; tone: string }> = {
  moved: { key: 'void.out.moved', icon: 'stock', tone: 'ok' },
  wastage: { key: 'void.out.wastage', icon: 'wastage', tone: 'danger' },
  staff_meal: { key: 'void.out.staff_meal', icon: 'meal', tone: 'brand' },
  other: { key: 'void.out.other', icon: 'dots', tone: 'mute' },
  released: { key: 'void.out.released', icon: 'released', tone: 'info' },
  parts_below: { key: 'void.out.parts_below', icon: 'below', tone: 'mute' },
};

export function OutcomeChip({ outcome }: { outcome: Outcome }) {
  const o = OUTCOME[outcome];
  return (
    <span className={`vout c-${o.tone}`}>
      <VIco name={o.icon} />
      {t(o.key)}
    </span>
  );
}

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';

export interface VoidDialogProps {
  title: string;
  sub?: string | undefined;
  ident?: string | undefined;
  /** `dlg--v` (the void sheet) or `dlg--all` (cancel order) */
  variant: 'v' | 'all';
  onClose(): void;
  children: ReactNode;
}

/**
 * The void dialog: `.scrim > .dlg.dlg--v` (or `--all`), a bottom sheet with a grip on a phone or a portrait tablet,
 * 1000 px on the cashier kiosk. Focus moves in on open and stays inside (Tab wraps); Escape closes.
 */
export function VoidDialog({ title, sub, ident, variant, onClose, children }: VoidDialogProps) {
  const shell = useShell();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const sheet = shell.phone || shell.portrait;
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || ref.current === null) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const kiosk = variant === 'v' && !sheet && shell.device.type === 'cashier_kiosk';
  return (
    <div className={sheet ? 'scrim scrim--sheet' : 'scrim'}>
      <div ref={ref} className={kiosk ? `dlg dlg--${variant} dlg--kiosk` : `dlg dlg--${variant}`} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} onKeyDown={onKey}>
        {sheet && <span className="dlg__grip" />}
        <div className="dlg__h">
          {ident !== undefined && (
            <span className={ident.includes('+') ? 'tcode j' : 'tcode'} dir="ltr">
              {ident}
            </span>
          )}
          <div className="dlg__t">
            <h2 id={id}>{title}</h2>
            {sub !== undefined && <div className="ac__who">{sub}</div>}
          </div>
          <button type="button" className="btn btn--icon dlg__x" aria-label={t('common.close')} onClick={onClose}>
            <Ico name="x" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** 04 §8 Void action (frame VoidAction): bin icon, "Void", and "Needs approval" when the grant is requires_approval (R5). */
export function VoidButton({ approval, onClick }: { approval: boolean; onClick(): void }) {
  return (
    <button type="button" className="btn btn--void" onClick={onClick}>
      <VIco name="bin" />
      {t('line.void')}
      {approval && <span className="ntag">{t('staff.grant.requires_approval')}</span>}
    </button>
  );
}

/** A button that stays focusable while off (`aria-disabled`), as the frames draw the primary button. */
export function OffButton({ off, className, onClick, children }: { off: boolean; className: string; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className={className} aria-disabled={off ? 'true' : undefined} onClick={() => (off ? undefined : onClick())}>
      {children}
    </button>
  );
}
