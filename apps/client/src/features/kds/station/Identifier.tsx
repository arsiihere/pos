import type { Identifier as Id } from '@pos/domain';
import { t } from '../../../i18n';

// 03b §4.4 (K2; frame 03b-C02): the identifier block of a KDS row — a table label ("T4 + T5", "Family 2"), a token
// "#12" with its day, or a parking plate with the car type. Identifiers are LTR (pulse-03 sets the direction).

/** a token's business date "2026-11-10" → "10 Nov" (01d alerts.months) */
export function dayLabel(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  const name = t('alerts.months').split(',')[(month ?? 1) - 1] ?? '';
  return `${day ?? ''} ${name}`.trim();
}

export function identifierText(id: Id): string {
  switch (id.kind) {
    case 'table':
      return id.label;
    case 'token':
      return `#${id.token}`;
    case 'parking':
      return id.car_number;
  }
}

export function Identifier({ id }: { id: Id }) {
  if (id.kind === 'parking') {
    return (
      <span className="kl__plate">
        <span className="plt">{id.car_number}</span>
        <small>{t(`kds.car.${id.car_type}`)}</small>
      </span>
    );
  }
  if (id.kind === 'token') {
    return (
      <span className="kl__n">
        #{id.token}
        {id.date !== null && <small>{dayLabel(id.date)}</small>}
      </span>
    );
  }
  return <span className="kl__n">{id.label}</span>;
}
