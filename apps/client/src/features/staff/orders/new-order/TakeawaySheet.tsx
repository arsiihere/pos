import { useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { CloseX, Dialog, Ico } from '../../../alerts/ui';
import { PHONE_RE } from '../send/send';

// 02-D03 Takeaway (02b §8 Types): name and phone both optional; a phone that is not 10–13 digits shows the inline
// error and Next waits (hub submit-order.ts phone rule). Spaces and dashes typed in a phone are dropped. The token
// comes after Send.

export const NAME_MAX = 40;

/** "0300 1234567" → "03001234567"; null when empty. */
export function phoneDigits(text: string): string | null {
  const d = text.replace(/[\s-]/g, '');
  return d === '' ? null : d;
}

export function TakeawaySheet({ sheet, onNext, onClose }: { sheet: boolean; onNext(details: { customer_name?: string; phone?: string }): void; onClose(): void }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const digits = phoneDigits(phone);
  const bad = digits !== null && !PHONE_RE.test(digits);
  const next = () => {
    if (bad) return;
    const n = name.trim();
    onNext({ ...(n === '' ? {} : { customer_name: n }), ...(digits === null ? {} : { phone: digits }) });
  };
  return (
    <Dialog sheet={sheet} labelledBy="tk-t" onClose={onClose}>
      <div className="dlg__h">
        <div className="dlg__t">
          <h2 id="tk-t">{t('order.takeaway')}</h2>
          <div className="ac__who">{t('order.takeaway.sub')}</div>
        </div>
        <CloseX onClose={onClose} />
      </div>
      <label className="fld">
        <span className="fld__l">
          {t('order.takeaway.name')}
          <span className="cntr num">{fill(t('note.count'), { n: String([...name].length), max: String(NAME_MAX) })}</span>
        </span>
        <input className="inp" dir="auto" maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="fld">
        <span className="fld__l">{t('order.takeaway.phone')}</span>
        <input className={bad ? 'inp err num' : 'inp num'} dir="ltr" inputMode="tel" value={phone} aria-invalid={bad} onChange={(e) => setPhone(e.target.value)} />
        {bad && (
          <span className="fld__e">
            <Ico name="warn" />
            {t('order.takeaway.phone_err')}
          </span>
        )}
      </label>
      <div className="acts">
        <button type="button" className="btn" onClick={() => onNext({})}>
          {t('order.takeaway.skip')}
        </button>
        <button type="button" className="btn btn--primary" disabled={bad} onClick={next}>
          {t('order.takeaway.next')}
        </button>
      </div>
    </Dialog>
  );
}
