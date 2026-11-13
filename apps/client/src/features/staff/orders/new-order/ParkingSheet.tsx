import { useState } from 'react';
import { t } from '../../../../i18n';
import { fill } from '../../../../i18n/en';
import { CloseX, Dialog, Ico } from '../../../alerts/ui';
import type { CarType } from '../contracts';
import { PHONE_RE, PLATE_RE } from '../send/send';
import { phoneDigits } from './TakeawaySheet';

// 02-D02 Parking / ParkingPhone (02b §8 Types): the plate is required, English letters, digits, space and dash, 2–12
// (/^[A-Za-z0-9 -]{2,12}$/, hub submit-order.ts), shown LTR in the mono plate style and kept upper case; the car
// type is required (Small car = `mini`, Sedan, Large); the phone is optional (10–13 digits).

const TYPES: Array<{ type: CarType; key: 'order.parking.small' | 'order.parking.sedan' | 'order.parking.large' }> = [
  { type: 'mini', key: 'order.parking.small' },
  { type: 'sedan', key: 'order.parking.sedan' },
  { type: 'large', key: 'order.parking.large' },
];

export function ParkingSheet({ sheet, onNext, onClose }: { sheet: boolean; onNext(details: { car_number: string; car_type: CarType; phone?: string }): void; onClose(): void }) {
  const [plate, setPlate] = useState('');
  const [type, setType] = useState<CarType | null>(null);
  const [phone, setPhone] = useState('');
  const car_number = plate.trim().toUpperCase();
  const plateOk = PLATE_RE.test(car_number);
  const digits = phoneDigits(phone);
  const phoneBad = digits !== null && !PHONE_RE.test(digits);
  const ok = plateOk && type !== null && !phoneBad;
  return (
    <Dialog sheet={sheet} labelledBy="pk-t" onClose={onClose}>
      <div className="dlg__h">
        <div className="dlg__t">
          <h2 id="pk-t">{t('order.parking')}</h2>
        </div>
        <CloseX onClose={onClose} />
      </div>
      <label className="fld">
        <span className="fld__l">
          {t('order.parking.plate')}
          <small>{t('order.parking.plate_hint')}</small>
          <span className="cntr num">{fill(t('note.count'), { n: String(plate.length), max: '12' })}</span>
        </span>
        <input className="inp inp--plate" dir="ltr" maxLength={12} autoCapitalize="characters" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} />
        {plate !== '' && !plateOk && (
          <span className="fld__e">
            <Ico name="warn" />
            {t('order.parking.plate_err')}
          </span>
        )}
      </label>
      <div className="fld">
        <span className="fld__l">
          {t('order.parking.type')}
          <small>{t('order.parking.required')}</small>
        </span>
        <div className="bchips">
          {TYPES.map((x) => (
            <button key={x.type} type="button" className={type === x.type ? 'bchip def' : 'bchip'} aria-pressed={type === x.type} onClick={() => setType(x.type)}>
              {t(x.key)}
            </button>
          ))}
        </div>
      </div>
      <label className="fld">
        <span className="fld__l">
          {t('order.takeaway.phone')}
          <small>{t('order.parking.optional')}</small>
        </span>
        <input className={phoneBad ? 'inp err num' : 'inp num'} dir="ltr" inputMode="tel" value={phone} aria-invalid={phoneBad} onChange={(e) => setPhone(e.target.value)} />
        {phoneBad && (
          <span className="fld__e">
            <Ico name="warn" />
            {t('order.takeaway.phone_err')}
          </span>
        )}
      </label>
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('note.cancel')}
        </button>
        <button type="button" className="btn btn--primary" disabled={!ok} onClick={() => ok && onNext({ car_number, car_type: type, ...(digits === null ? {} : { phone: digits }) })}>
          {t('order.takeaway.next')}
        </button>
      </div>
    </Dialog>
  );
}
