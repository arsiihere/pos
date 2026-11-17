import { t } from '../../../../i18n';
import { Ico, Ring, Tags, tableOf, type RowLike } from '../../../alerts/ui';

// 02a §6.14, owner Q-12 (02a-C05 CallWaiterCard): the waiter's action banner "F4 · Call", plus " · Ali" when the
// hub sends the caller's name (`requester_name`, hub task H7); never the chip (the alert carries none, G2a-2).

export const CALL_KIND = 'call_waiter';

/** "Call · Ali", or "Call" without a caller name; the table is the card's own code. */
export function callTitle(row: RowLike): string {
  const name = (row.card ?? row.lock).requester_name ?? null;
  const call = t('alert.call_waiter.card');
  return name === null || name === '' ? call : `${call} · ${name}`;
}

export function CallCard({ row, onOpen }: { row: RowLike; onOpen: () => void }) {
  const table = tableOf(row);
  return (
    <div className="abn c-info" role="alert" data-alert={row.alert_id}>
      <Ring size={56} pct={null} tone="info">
        <Ico name="hand" />
      </Ring>
      <div className="ac__body">
        <Tags row={row} />
        <div className="ac__title">
          {table !== null && (
            <span className="tcode tcode--sm" dir="ltr">
              {table}
            </span>
          )}
          <b>{callTitle(row)}</b>
        </div>
      </div>
      <button type="button" className="btn btn--tone c-info" onClick={onOpen}>
        {t('alerts.open')}
        <Ico name="chev" />
      </button>
    </div>
  );
}
