import type { ReactNode } from 'react';
import type { CloudError, MenuItem } from '../../api/cloud-admin';
import { usePhone } from '../../app/phone';
import { navigate } from '../../app/router';
import { Icon, type IconName } from '../../components/Icon';
import { t } from '../../i18n';
import { referenceKey } from './form';
import { useLeave } from './guard';

// Shared pieces of the 01c owner lists and forms (size groups, stock items; later choice groups and deals).

// §8, Q12: lists sort by sort_order, then name.
export function bySortThenName<T extends { sort_order: number; name: string }>(a: T, b: T): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

// A size's short label on chips ("Half"); a plain item shows its name.
export function sizeLabel(item: Pick<MenuItem, 'name' | 'variant_name'>): string {
  return item.variant_name ?? item.name;
}

// The item form's place (#/menu, 01a S50); `item` opens one item, `new_size_of` a new size of a group
// (Q16: group and category prefilled). Both are read by the menu view's item form.
export function itemHref(itemId: string): string {
  return `#/menu?item=${encodeURIComponent(itemId)}`;
}
export function newSizeHref(variantGroupId: string): string {
  return `#/menu?new_size_of=${encodeURIComponent(variantGroupId)}`;
}

// The status code of an API refusal, or null.
export function apiCode(error: CloudError): string | null {
  return error.kind === 'api' ? error.code : null;
}

// 01c-B01, Q7, 01c P1: the text for a 422 CONFIG_REFERENCE_INVALID { field, reason }: errors.reference.<reason>,
// unit_mismatch on a stock item's own unit (stock_unit) has its own text; any other reason → the generic text.
export function referenceText(details: Record<string, unknown>): string {
  return t(referenceKey(details));
}

// A form's back link to its list; the arrow alone on a phone (StockItemPhone). It goes through the
// unsaved-changes guard (S50 c) like Cancel; with no dirty form it just navigates.
export function BackLink({ href, list, label }: { href: string; list: string; label: string }) {
  const phone = usePhone();
  const leave = useLeave();
  return (
    <a
      className="pos-btn"
      href={href}
      aria-label={label}
      onClick={(event) => {
        event.preventDefault();
        leave(() => navigate(href.replace(/^#/, '')));
      }}
    >
      <Icon name="back" flip />
      {!phone && list}
    </a>
  );
}

// The empty list card (SizeGroupsEmpty, StockItemsEmpty): icon, title, line and the way forward.
export function ListEmpty({ icon, title, body, children }: { icon: IconName; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="pos-empty pos-card">
      <span className="pos-gone__icon">
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      {body !== undefined && <p className="body">{body}</p>}
      {children}
    </div>
  );
}

// The list toolbar: search on the start side, the "Archived shown ✕" chip, the helper line at the end (laptop).
export function ListBar({
  search,
  onSearch,
  placeholder,
  archived,
  onHideArchived,
  hideArchivedLabel,
  helper,
}: {
  search: string;
  onSearch: (next: string) => void;
  placeholder: string;
  archived: boolean;
  onHideArchived: () => void;
  hideArchivedLabel: string;
  helper: string;
}) {
  const phone = usePhone();
  return (
    <div className="pos-c01bar">
      <label className="pos-input-affix pos-c01bar__search">
        <span>
          <Icon name="search" />
        </span>
        <input
          className="pos-input"
          type="search"
          name="q"
          maxLength={60}
          placeholder={placeholder}
          aria-label={placeholder}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </label>
      {archived && (
        <button type="button" className="pos-filterchip" aria-label={hideArchivedLabel} onClick={onHideArchived}>
          <Icon name="archive" />
          {t('c01.archived_shown')}
          <Icon name="x" />
        </button>
      )}
      {!phone && <span className="pos-note pos-c01bar__note">{helper}</span>}
    </div>
  );
}
