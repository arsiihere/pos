import type { ReactNode } from 'react';
import type { CloudAdmin, CloudError } from '../../api/cloud-admin';
import { Chip } from '../../components/Chip';
import { Dialog } from '../../components/Dialog';
import { fill } from '../../i18n/en';
import { t, typeClass } from '../../i18n';

// S50 b: a 409 CONFIG_IN_USE shows the reason and a way forward instead of an Archive button. Item ids
// are named from one GET /v1/admin/menu?limit=200 (pilot menu < 200 items, §12.7); the rest show as
// "and N more".
// Who can use a row: items (the default), stations (alternates, A-9), stock items (01c V16), size groups
// (a category's variant groups, §6.13) and deals (01c V16: a category or tax class an active deal keeps).
export type UsedBy = 'station' | 'stock_item' | 'variant_group' | 'deal';
export interface InUse {
  ids: string[];
  names: string[];
  // Who uses the row: items when absent.
  by?: UsedBy;
}

export function usedIds(error: CloudError): string[] | null {
  if (error.kind !== 'api' || error.code !== 'CONFIG_IN_USE') return null;
  const usedBy = error.details['used_by'] as { ids?: unknown } | undefined;
  return Array.isArray(usedBy?.ids) ? usedBy.ids.filter((id): id is string => typeof id === 'string') : [];
}

// The entity that uses the refused row: items (routes), stations (alternates, A-9), stock items (counted at a
// station, 01c V16), size groups (a category's variant groups, §6.13) or deals (01c V16). Anything else is items.
export function usedEntity(error: CloudError): 'item' | UsedBy {
  const usedBy = error.kind === 'api' ? (error.details['used_by'] as { entity?: unknown } | undefined) : undefined;
  const entity = usedBy?.entity;
  return entity === 'station' || entity === 'stock_item' || entity === 'variant_group' || entity === 'deal' ? entity : 'item';
}

// Deals are named from the active deal list (an archived deal never blocks, AD-11); a failed read names none.
export async function dealNames(api: CloudAdmin, ids: readonly string[]): Promise<InUse> {
  const result = await api.listDeals({ status: 'active' });
  const byId = new Map(result.ok ? result.data.deals.map((deal) => [deal.deal_id, deal.name]) : []);
  return { ids: [...ids], names: ids.flatMap((id) => byId.get(id) ?? []), by: 'deal' };
}

export async function itemNames(api: CloudAdmin, ids: readonly string[]): Promise<InUse & { by?: undefined }> {
  const result = await api.getMenu({ limit: 200 });
  const byId = new Map(result.ok ? result.data.items.map((item) => [item.item_id, item.name]) : []);
  return { ids: [...ids], names: ids.flatMap((id) => byId.get(id) ?? []) };
}

export function BlockedDialog({
  title,
  body,
  inUse,
  onClose,
  action,
}: {
  title: string;
  body: string;
  inUse: InUse;
  onClose: () => void;
  action?: ReactNode;
}) {
  const more = inUse.ids.length - inUse.names.length;
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="pos-btn" onClick={onClose}>
            {t('common.close')}
          </button>
          {action}
        </>
      }
    >
      <p className="pos-dialog__body">{body}</p>
      <div className="pos-row" data-in-use="">
        {inUse.names.map((name, i) => (
          <Chip key={`${name}-${i}`}>{name}</Chip>
        ))}
        {more > 0 && <span className={typeClass('body')}>{fill(t('archive.and_more'), { n: String(more) })}</span>}
      </div>
    </Dialog>
  );
}
