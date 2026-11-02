import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { t } from '../../i18n';
import { PIN_MIN, type HubLink, type PinPad } from './answer';
import { CloseX, Ico, Msg, type IconName } from './ui';

// 01d D02 (frames Pin, PinReject, PinWrong, PinLocked, PinBusy, PinOffline): 4 dots and a 3 × 4 pad of 104 × 64
// keys; the last key is the layer's only primary (Approve / Reject / Sign in). One error line above the pad.
// Locked out or offline: the keys are off. Digits also come from a keyboard (Enter sends, Backspace deletes).

export interface PinError {
  text: string;
  tone: 'danger' | 'warn';
  icon: IconName;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function PinKeys({
  length,
  disabled,
  actionLabel,
  onDigit,
  onBack,
  onSubmit,
  error,
  narrow = false,
}: {
  length: number;
  disabled: boolean;
  actionLabel: string;
  onDigit: (d: string) => void;
  onBack: () => void;
  onSubmit: () => void;
  error: PinError | null;
  narrow?: boolean;
}) {
  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    if (/^\d$/.test(e.key)) onDigit(e.key);
    else if (e.key === 'Backspace') onBack();
    else if (e.key === 'Enter' && length >= PIN_MIN) onSubmit();
    else return;
    e.preventDefault();
  };
  const dots = Math.max(4, length);
  // focus moves into the pad when it opens, so keyboard digits work at once (kiosk)
  const keysRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    keysRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
  }, []);
  return (
    <>
      <div className={`pin__dots${error?.tone === 'danger' && length === 0 ? ' err' : ''}`} aria-label={`${length} digits`} role="status">
        {Array.from({ length: dots }, (_, i) => (
          <i key={i} className={i < length ? 'f' : ''} />
        ))}
      </div>
      {error !== null && (
        <p className={`pin__err${error.tone === 'warn' ? ' warn' : ''}`} role="alert">
          <Ico name={error.icon} />
          {error.text}
        </p>
      )}
      <div ref={keysRef} className={`pin__keys${disabled ? ' off' : ''}${narrow ? ' pin__keys--96' : ''}`} onKeyDown={onKey}>
        {DIGITS.map((d) => (
          <button key={d} type="button" className="btn" disabled={disabled} onClick={() => onDigit(d)}>
            {d}
          </button>
        ))}
        <button type="button" className="btn btn--fn" disabled={disabled} onClick={onBack}>
          {t('pin.delete')}
        </button>
        <button type="button" className="btn" disabled={disabled} onClick={() => onDigit('0')}>
          0
        </button>
        <button type="button" className="btn btn--primary" disabled={disabled || length < PIN_MIN} onClick={onSubmit}>
          {actionLabel}
        </button>
      </div>
    </>
  );
}

/** D02 / D03 PIN step in the answer dialog; the digits stay in the pad (answer.ts), never in React state. */
export function PinStep({
  title,
  sub,
  pad,
  link,
  actionLabel,
  onSubmit,
  error,
  locked,
  help,
  topMessage,
  onBack,
  onClose,
}: {
  title: string;
  sub: ReactNode;
  pad: PinPad;
  link: HubLink;
  actionLabel: string;
  onSubmit: () => void;
  error: PinError | null;
  locked: boolean;
  help: string | null;
  topMessage: string | null;
  onBack: () => void;
  onClose: () => void;
}) {
  const length = useSyncExternalStore(pad.subscribe, () => pad.length());
  const disabledPad = useSyncExternalStore(pad.subscribe, () => pad.disabled());
  const up = useSyncExternalStore(link.subscribe, () => link.isUp());
  const offline = !up;
  return (
    <>
      <div className="dlg__h">
        <button type="button" className="btn" onClick={onBack}>
          <Ico name="back" />
          {t('answer.back')}
        </button>
        <span className="grow" />
        <CloseX onClose={onClose} />
      </div>
      {offline ? <Msg tone="danger" icon="wifioff" text={t('answer.error.offline')} /> : topMessage !== null && <Msg tone="danger" icon="warn" text={topMessage} />}
      <div className="pin">
        <h2 className="pin__t" id="dt">
          {title}
        </h2>
        <p className="pin__s">{sub}</p>
        <PinKeys
          length={length}
          disabled={offline || locked || disabledPad}
          actionLabel={actionLabel}
          onDigit={(d) => pad.press(d)}
          onBack={() => pad.back()}
          onSubmit={onSubmit}
          error={offline ? null : error}
        />
        {help !== null && <p className="pin__help">{help}</p>}
      </div>
    </>
  );
}
