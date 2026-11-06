import { useEffect, useState } from 'react';
import type { Category, CloudAdmin, MenuItem } from '../../../api/cloud-admin';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { loadEveryItem } from '../menu-pages';

// 01a v2.1 §8.1 (A-13): the "Goes with" picker on a category and an item. A link names a whole category or one
// item; only an item's list can also mark a target "Never suggest" (excluded). The list is sent whole on save
// (the cloud replaces it), so a target archived since is dropped here, or the cloud would refuse the resend (C4).
export type GoesWithKind = 'category' | 'item';
export interface GoesWithLink {
  target_kind: GoesWithKind;
  target_id: string;
  excluded: boolean;
}

const keyOf = (link: Pick<GoesWithLink, 'target_kind' | 'target_id'>) => `${link.target_kind}:${link.target_id}`;

// Every item, active and archived together, read when a form with a picker opens (loadEveryItem: one menu read
// per page of 200 for the active rows, then the same for the archived rows; at least 2 reads). The menu list's own
// page is filtered and partial, so it cannot tell "archived" from "not on this page". null = not read (yet);
// failed = the read did not work, so the picker stays off and the list is never sent.
export function useEveryItem(api: CloudAdmin, enabled: boolean): { items: MenuItem[] | null; failed: boolean } {
  const [state, setState] = useState<{ items: MenuItem[] | null; failed: boolean }>({ items: null, failed: false });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      try {
        const result = await loadEveryItem(api);
        if (!live) return;
        setState(result.ok && Array.isArray(result.data.items) ? { items: result.data.items, failed: false } : { items: null, failed: true });
      } catch {
        if (live) setState({ items: null, failed: true });
      }
    })();
    return () => {
      live = false;
    };
  }, [api, enabled]);
  return state;
}

// The stored links as the form holds them. Only a target positively known to be archived (or the source itself)
// is left out; one the menu read did not return is kept and sent back unchanged.
export function goesWithState(
  stored: readonly { target_kind: GoesWithKind; target_id: string; excluded: boolean }[],
  categories: readonly Category[],
  items: readonly MenuItem[],
  self: { kind: GoesWithKind; id: string },
): GoesWithLink[] {
  return stored
    .filter((link) => {
      if (link.target_kind === self.kind && link.target_id === self.id) return false;
      const target =
        link.target_kind === 'category'
          ? categories.find((c) => c.category_id === link.target_id)
          : items.find((i) => i.item_id === link.target_id);
      return target === undefined || target.archived_at === null;
    })
    .map((link) => ({ target_kind: link.target_kind, target_id: link.target_id, excluded: link.excluded }));
}

export const sameGoesWith = (a: readonly GoesWithLink[], b: readonly GoesWithLink[]) => JSON.stringify(a) === JSON.stringify(b);

export function GoesWithPicker({
  value,
  onChange,
  categories,
  items,
  self,
  error,
  disabled = false,
  failed = false,
}: {
  value: GoesWithLink[];
  onChange: (next: GoesWithLink[]) => void;
  categories: readonly Category[];
  items: readonly MenuItem[];
  self: { kind: GoesWithKind; id: string };
  error?: string | undefined;
  disabled?: boolean;
  failed?: boolean;
}) {
  const isItem = self.kind === 'item';
  const nameOf = (link: GoesWithLink) =>
    (link.target_kind === 'category'
      ? categories.find((c) => c.category_id === link.target_id)?.name
      : items.find((i) => i.item_id === link.target_id)?.name) ?? link.target_id;
  const taken = new Set(value.map(keyOf));
  const notSelf = (kind: GoesWithKind, id: string) => !(self.kind === kind && self.id === id);
  const freeCategories = categories.filter((c) => c.archived_at === null && notSelf('category', c.category_id) && !taken.has(`category:${c.category_id}`));
  const freeItems = items.filter((i) => i.archived_at === null && notSelf('item', i.item_id) && !taken.has(`item:${i.item_id}`));

  return (
    <section className={`pos-section${error === undefined ? '' : ' pos-field--error'}`} data-section="goes-with" id="item-goes_with" tabIndex={-1}>
      <div className="pos-section__head pos-section__head--sub">
        <h3>{t('goeswith.title')}</h3>
        <p>{t('goeswith.help')}{isItem && ` ${t('goeswith.help_item')}`}</p>
      </div>
      {error !== undefined && <span className="pos-field__error">{error}</span>}
      {disabled && <p className="pos-field__help">{t(failed ? 'goeswith.failed' : 'goeswith.loading')}</p>}
      {value.length === 0 && <p className="pos-field__help">{t('goeswith.none')}</p>}
      {value.map((link) => (
        <div key={keyOf(link)} className="pos-row" data-goes-with={keyOf(link)}>
          <strong>{nameOf(link)}</strong>
          <small>{t(link.target_kind === 'category' ? 'goeswith.category' : 'goeswith.item')}</small>
          {isItem && (
            <button
              type="button"
              role="checkbox"
              aria-checked={link.excluded}
              disabled={disabled}
              className={`pos-tick${link.excluded ? ' is-on' : ''}`}
              onClick={() => onChange(value.map((x) => (keyOf(x) === keyOf(link) ? { ...x, excluded: !x.excluded } : x)))}
            >
              <i />
              {t('goeswith.never')}
            </button>
          )}
          <button
            type="button"
            className="pos-btn"
            disabled={disabled}
            aria-label={fill(t('goeswith.remove'), { name: nameOf(link) })}
            onClick={() => onChange(value.filter((x) => keyOf(x) !== keyOf(link)))}
          >
            {t('owner.stations.remove')}
          </button>
        </div>
      ))}
      <label className="pos-field">
        <span className="pos-field__label">{t('goeswith.add')}</span>
        <select
          className="pos-select"
          name="goes_with_add"
          disabled={disabled}
          value=""
          onChange={(e) => {
            const [kind, ...rest] = e.target.value.split(':');
            if (e.target.value === '' || (kind !== 'category' && kind !== 'item')) return;
            onChange([...value, { target_kind: kind, target_id: rest.join(':'), excluded: false }]);
          }}
        >
          <option value="">{t('goeswith.pick')}</option>
          {freeCategories.map((c) => (
            <option key={c.category_id} value={`category:${c.category_id}`}>
              {`${t('goeswith.category')}: ${c.name}`}
            </option>
          ))}
          {freeItems.map((i) => (
            <option key={i.item_id} value={`item:${i.item_id}`}>
              {`${t('goeswith.item')}: ${i.name}`}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
