import { useState } from 'react';
import { t } from '../../../../i18n';
import { Ico } from '../../../alerts/ui';
import type { Cart } from './cart';
import { NAME_MAX, phoneBad } from './contact';

// 02b-TK C1-2 (frames HomeKiosk, PhoneInvalid, PhoneCart; 02b §3.1, §6.1; R1): the takeaway customer row at the top of
// the cart — Name · optional, Phone · optional with the +92 mask and the numeric pad (`inputmode="tel"`). Both stay
// optional; a typed phone the hub would refuse shows "Enter 10 digits after +92" and Send waits (OrderScreen). What is
// typed goes into the cart as typed (the draft keeps it); Send carries the hub's form (contact.ts). The pickup chips
// of the frames come with 02b v1.0.25 (R4, Part B).

export type Contact = NonNullable<Cart['takeaway']>;

// 02b-TK A2 item 4 (frame HomeRush; CHANGES §3 Cart "In rush mode it collapses to one Name / phone button"): `compact`
// folds the row into one button (the name and phone when typed); a tap, or a phone to fix, opens the fields.
export function CustomerRow({ value, disabled, onChange, compact = false }: { value: Cart['takeaway']; disabled: boolean; onChange(next: Cart['takeaway']): void; compact?: boolean }) {
  const name = value?.customer_name ?? '';
  const phone = value?.phone ?? '';
  const bad = phoneBad(value?.phone);
  const [unfolded, setUnfolded] = useState(false);
  if (compact && !unfolded && !bad) {
    const typed = [name, phone].filter((x) => x !== '');
    return (
      <div className="cust cust--compact">
        <button type="button" className="tk-btn" disabled={disabled} onClick={() => setUnfolded(true)}>
          <Ico name="user" />
          {typed.length === 0 ? (
            t('c.who_add')
          ) : (
            <span dir="auto">
              {name}
              {phone !== '' && (
                <>
                  {name !== '' && ' · '}
                  <span className="num" dir="ltr">
                    {phone}
                  </span>
                </>
              )}
            </span>
          )}
        </button>
      </div>
    );
  }
  const set = (next: Contact) => {
    const n = next.customer_name ?? '';
    const p = next.phone ?? '';
    onChange(n === '' && p === '' ? undefined : { ...(n === '' ? {} : { customer_name: n }), ...(p === '' ? {} : { phone: p }) });
  };
  return (
    <div className="cust duo">
      <label className="fld">
        <span className="fld__l">
          {t('c.name')} · <small>{t('c.optional')}</small>
          {/* ⚠️ 02b v1.0.30 QK-7 (BUG-24): the hub's limit, counted as typed */}
          <small className="fld__count num" dir="ltr" data-count="">
            {name.length}/{NAME_MAX}
          </small>
        </span>
        <input
          className="inp"
          name="customer_name"
          dir="auto"
          autoComplete="off"
          maxLength={NAME_MAX}
          placeholder={t('c.name_ph')}
          value={name}
          disabled={disabled}
          onChange={(e) => set({ ...value, customer_name: e.target.value })}
        />
      </label>
      <label className="fld">
        <span className="fld__l">
          {t('c.phone')} · <small>{t('c.optional')}</small>
        </span>
        <input
          className={bad ? 'inp err num' : 'inp num'}
          name="phone"
          dir="ltr"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder="+92 3xx xxxxxxx"
          value={phone}
          disabled={disabled}
          aria-invalid={bad}
          onChange={(e) => set({ ...value, phone: e.target.value })}
        />
        {bad && (
          <span className="fld__e" role="alert">
            <Ico name="warn" />
            {t('c.phone_err')}
          </span>
        )}
      </label>
    </div>
  );
}
