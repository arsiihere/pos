import type { HubResult } from '../../../api/hub-admin';
import { t } from '../../../i18n';
import type { PassApi } from '../contracts';

// 03b v1.0.8 §3.5 step 1, §3.10 (P5; frame 03b-B15 PassArchived, brief B13): a Pass command answered
// `404 POINT_NOT_FOUND` — this tablet's point is archived. The danger line; every action hidden until the next
// catch-up (the tablet bound to another point, or the point back).

export function PointArchived() {
  return (
    <div className="msg c-danger" role="alert">
      <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3l9.5 17h-19z" />
        <path d="M12 10v4.5" />
        <path d="M12 17.5v.01" />
      </svg>
      <span>{t('pass.point_archived')}</span>
    </div>
  );
}

/** The PassApi with every answer checked for `404 POINT_NOT_FOUND` (→ `onArchived`); the answer itself is passed on. */
export function watchPoint(api: PassApi, onArchived: () => void): PassApi {
  const check = <R extends HubResult<unknown>>(r: R): R => {
    if (!r.ok && r.error.kind === 'api' && r.error.code === 'POINT_NOT_FOUND') onArchived();
    return r;
  };
  return {
    markReadyToServe: (p) => api.markReadyToServe(p).then(check),
    undoReadyToServe: (p) => api.undoReadyToServe(p).then(check),
    handover: (p) => api.handover(p).then(check),
    passReceivers: (order_id) => api.passReceivers(order_id).then(check),
    orderTickets: (order_id) => api.orderTickets(order_id).then(check),
  };
}
