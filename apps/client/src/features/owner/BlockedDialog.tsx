import type { ReactNode } from 'react';
import type { CloudAdmin, CloudError } from '../../api/cloud-admin';
import { Chip } from '../../components/Chip';
import { Dialog } from '../../components/Dialog';
import { fill } from '../../i18n/en';
import { t, typeClass } from '../../i18n';

// S50 b: a 409 CONFIG_IN_USE shows the reason and a way forward instead of an Archive button. Item ids
// are named from one GET /v1/admin/menu?limit=200 (pilot menu < 200 items, §12.7); the rest show as
// "and N more".
export interface InUse {
  ids: string[];
  names: string[];
}

export function usedIds(error: CloudError): string[] | null {
  if (error.kind !== 'api' || error.code !== 'CONFIG_IN_USE') return null;
  const usedBy = error.details['used_by'] as { ids?: unknown } | undefined;
  return Array.isArray(usedBy?.ids) ? usedBy.ids.filter((id): id is string => typeof id === 'string') : [];
}

export async function itemNames(api: CloudAdmin, ids: readonly string[]): Promise<InUse> {
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
