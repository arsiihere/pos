import { useEffect, useRef, type ReactNode } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { Ico } from '../../../alerts/ui';
import { useShell } from '../../shell/hooks';

// 02a §8 Open (02-B01 TableBusy, TableBusyOwn): someone else is taking an order here (`409 TABLE_ALREADY_LOCKED`
// or the tile's lock), or my own order is open on another screen (T15; Q-25: no device name, the tile carries
// none). The dialog chrome (centred on tablet / kiosk, a bottom sheet on portrait / phone) is shared by the 02a
// dialogs.

export interface DialogFrameProps {
  /** the table chip ("F7", "F4 + F5") */
  code: string;
  title: string;
  onClose(): void;
  children: ReactNode;
}

export function DialogFrame({ code, title, onClose, children }: DialogFrameProps) {
  const { phone, portrait } = useShell();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);
  return (
    <div className={phone || portrait ? 'scrim scrim--sheet' : 'scrim'}>
      <div
        className="dlg"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={box}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        {(phone || portrait) && <div className="dlg__grip" aria-hidden="true" />}
        <div className="dlg__h">
          <span className={`tcode${code.includes('+') ? ' j' : ''}`} dir="ltr">
            {code}
          </span>
          <div className="dlg__t">
            <h2>{title}</h2>
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

export interface TableBusyProps {
  code: string;
  /** the locker's name (`locked_by_name` or the tile's lock) */
  name: string;
  /** `force-release-table-lock` allowed: Release {name}'s lock */
  canRelease: boolean;
  onClose(): void;
  onRelease(): void;
}

export function TableBusy({ code, name, canRelease, onClose, onRelease }: TableBusyProps) {
  return (
    <DialogFrame code={code} title={fill(t('busy.title'), { name })} onClose={onClose}>
      <div className="ro" role="status">
        <Ico name="info" />
        <span>{t('busy.still_can')}</span>
      </div>
      <div className={canRelease ? 'acts acts--eq' : 'acts'}>
        <button type="button" className="btn" onClick={onClose}>
          {t('busy.see_table')}
        </button>
        {canRelease && (
          <button type="button" className="btn btn--tone c-danger" onClick={onRelease}>
            <Ico name="lock" />
            {fill(t('sheet.act.release_other'), { name })}
          </button>
        )}
      </div>
    </DialogFrame>
  );
}

export interface TableBusyOwnProps {
  code: string;
  onClose(): void;
  /** Open here = OpenTable (the lock moves to this device, T15) */
  onOpenHere(): void;
}

export function TableBusyOwn({ code, onClose, onOpenHere }: TableBusyOwnProps) {
  return (
    <DialogFrame code={code} title={fill(t('busy.own_other_screen'), { table: code })} onClose={onClose}>
      <p className="dlg__line">{fill(t('busy.own_line'), { table: code })}</p>
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('busy.see_table')}
        </button>
        <button type="button" className="btn btn--primary" onClick={onOpenHere}>
          {t('busy.open_here')}
        </button>
      </div>
    </DialogFrame>
  );
}
