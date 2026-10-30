import { useId, useRef, useState } from 'react';
import type { MenuItem } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { useModalFocus } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { shownRupees } from '../money';
import { quantityText, unitWord, type SaleUnit } from './deals';

// 01c-D03 (§3.3, §8 "Parts with choices"; CHANGES §2): "Choices for part {n}", "{qty} · all choices must be sold
// by {unit}", search, one tick row per active item. Items not allowed stay listed, disabled with the reason
// (weighed when served, V18; another sale unit than the part's, choice_unit_mismatch). The part's current
// choices show ticked (removed with × on the form); up to 20 choices. Primary "Add {n} to part". Wide dialog;
// full screen on a phone.
export const MAX_CHOICES = 20;

export function ChoicePicker({
  part,
  quantity,
  unit,
  items,
  categories,
  current,
  inOtherParts,
  onClose,
  onAdd,
}: {
  part: number;
  quantity: number | null;
  unit: SaleUnit | null;
  items: readonly MenuItem[];
  categories: readonly { category_id: string; name: string; sort_order: number }[];
  current: readonly string[];
  inOtherParts: ReadonlySet<string>;
  onClose: () => void;
  onAdd: (itemIds: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onKeyDown = useModalFocus(box, onClose);
  const phone = usePhone();

  const byId = new Map(items.map((item) => [item.item_id, item]));
  // The part's unit: its choices' unit, else the first item ticked here.
  const partUnit = unit ?? (picked[0] === undefined ? null : (byId.get(picked[0])?.sale_unit ?? null));
  const category = new Map(categories.map((c) => [c.category_id, c]));
  const needle = search.trim().toLowerCase();
  const rows = items
    .filter((item) => item.archived_at === null && (needle === '' || item.name.toLowerCase().includes(needle)))
    .sort(
      (a, b) =>
        (category.get(a.category_id)?.sort_order ?? 0) - (category.get(b.category_id)?.sort_order ?? 0) ||
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name),
    );
  const full = current.length + picked.length >= MAX_CHOICES;
  const per = (u: SaleUnit) => (u === 'piece' ? '' : ` ${u === 'g' ? t('menu.per.kg') : t('menu.per.l')}`);

  const sub =
    partUnit === null
      ? t('deal_picker.sub_any')
      : fill(t('deal_picker.sub'), {
          qty: quantity === null ? '' : quantityText(quantity, partUnit),
          unit: unitWord(partUnit),
        }).replace(/^ · /, '');

  return (
    <div className="pos-scrim">
      <div
        ref={box}
        className={`pos-dialog pos-dialog--form ${phone ? 'pos-dialog--full' : 'pos-dialog--wide'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-choice-picker=""
      >
        <div className="pos-dialog__head">
          <div>
            <h2 className="pos-dialog__title" id={titleId}>
              {fill(t('deal_picker.title'), { n: String(part) })}
            </h2>
            <p className="pos-note pos-picker__sub">{sub}</p>
          </div>
          <button type="button" className="pos-btn" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <label className="pos-input-affix pos-picker__search">
          <span>
            <Icon name="search" />
          </span>
          <input
            className="pos-input"
            type="search"
            name="item_q"
            placeholder={t('deal_picker.search')}
            aria-label={t('deal_picker.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="pos-dialog__scroll">
          {rows.length === 0 && <p className="pos-note">{fill(t('c01.no_match'), { q: search.trim() })}</p>}
          {rows.map((item) => {
            const already = current.includes(item.item_id);
            const on = already || picked.includes(item.item_id);
            let reason: string | null = null;
            if (item.requires_weighing) reason = t('deal_picker.weighed');
            else if (partUnit !== null && item.sale_unit !== partUnit)
              reason = fill(t('deal_picker.other_unit'), { unit: unitWord(item.sale_unit) });
            else if (!on && full) reason = t('deal_picker.full');
            const off = reason !== null;
            const detail =
              reason ??
              [
                fill(t('deal_picker.by'), { category: category.get(item.category_id)?.name ?? '', unit: unitWord(item.sale_unit) }),
                ...(inOtherParts.has(item.item_id) ? [t('deal_picker.two_parts')] : []),
              ].join(' · ');
            return (
              <button
                key={item.item_id}
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-disabled={off || already ? true : undefined}
                className={`pos-pick${off ? ' is-off' : ''}`}
                data-item-id={item.item_id}
                onClick={() => {
                  if (off || already) return;
                  setPicked(on ? picked.filter((id) => id !== item.item_id) : [...picked, item.item_id]);
                }}
              >
                <span className={`pos-tick${on ? ' is-on' : ''}`}>
                  <i />
                </span>
                <span>
                  {item.name}
                  <small>{detail}</small>
                </span>
                <span className="num">{`${t('owner.menu.rupees')} ${shownRupees(item.price_minor)}${per(item.sale_unit)}`}</span>
              </button>
            );
          })}
        </div>
        <div className="pos-dialog__footer">
          <button type="button" className="pos-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="pos-btn pos-btn--primary" disabled={picked.length === 0} onClick={() => onAdd(picked)}>
            {fill(t('deal_picker.add'), { n: String(picked.length) })}
          </button>
        </div>
      </div>
    </div>
  );
}
