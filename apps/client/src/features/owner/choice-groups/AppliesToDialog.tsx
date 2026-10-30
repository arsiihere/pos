import { useId, useRef, useState } from 'react';
import type { ModifierLink } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { useModalFocus } from '../../../components/Dialog';
import { Icon } from '../../../components/Icon';
import { Segmented } from '../../../components/Segmented';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { bySortThenName } from '../c01';
import type { WholeMenu } from '../menu-pages';
import { MenuRetry } from './useMenuPages';

// 01c-D02 "Applies to" (§8 "Views", V8; Q13): a wide dialog (full screen on a phone) with search, tabs with
// counts (Categories · Size groups · Items; items grouped by category, growing as the menu pages arrive), a
// 3-way control per row — "—" (no link) / "Use" (attach) / "Not here" (detach; never on a category, §3.3) —
// and the strip "Used on n · Not here on m". Done hands the whole list back; it is saved with the group.
type Kind = ModifierLink['target_kind'];
type Mode = 'none' | ModifierLink['mode'];

export function AppliesToDialog({
  groupName,
  menu,
  loading,
  error = null,
  onRetry,
  links,
  onDone,
  onClose,
}: {
  groupName: string;
  menu: WholeMenu;
  loading: boolean;
  error?: string | null;
  onRetry?: () => void;
  links: readonly ModifierLink[];
  onDone: (links: ModifierLink[]) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onKeyDown = useModalFocus(box, onClose);
  const phone = usePhone();
  const [draft, setDraft] = useState<ModifierLink[]>([...links]);
  const [tab, setTab] = useState<Kind>('category');
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const match = (name: string) => needle === '' || name.toLowerCase().includes(needle);

  const modeOf = (kind: Kind, id: string): Mode => draft.find((l) => l.target_kind === kind && l.target_id === id)?.mode ?? 'none';
  const setMode = (kind: Kind, id: string, mode: Mode) =>
    setDraft((prev) => {
      const rest = prev.filter((l) => !(l.target_kind === kind && l.target_id === id));
      return mode === 'none' ? rest : [...rest, { target_kind: kind, target_id: id, mode }];
    });

  const categories = menu.categories.filter((c) => c.archived_at === null).sort(bySortThenName);
  const sizeGroups = menu.variant_groups.filter((g) => g.archived_at === null).sort(bySortThenName);
  const items = menu.items.filter((i) => i.archived_at === null);
  const categoryName = (id: string) => menu.categories.find((c) => c.category_id === id)?.name ?? '';
  const used = draft.filter((l) => l.mode === 'attach').length;
  const off = draft.filter((l) => l.mode === 'detach').length;

  const row = (kind: Kind, id: string, name: string, sub: string) => {
    const choices: { value: Mode; label: string }[] = [
      { value: 'none', label: '—' },
      { value: 'attach', label: t('applies.use') },
      ...(kind === 'category' ? [] : [{ value: 'detach' as const, label: t('applies.not_here') }]),
    ];
    return (
      <div key={`${kind}-${id}`} className="pos-target" data-target={id}>
        <span>
          {name}
          {sub !== '' && <small>{sub}</small>}
        </span>
        <Segmented<Mode> label={name} value={modeOf(kind, id)} onChange={(mode) => setMode(kind, id, mode)} options={choices} />
      </div>
    );
  };

  let rows;
  if (tab === 'category')
    rows = categories
      .filter((c) => match(c.name))
      .map((c) => {
        const n = items.filter((i) => i.category_id === c.category_id).length;
        return row('category', c.category_id, c.name, fill(t('applies.n_items'), { n: String(n) }));
      });
  else if (tab === 'variant_group')
    rows = sizeGroups
      .filter((g) => match(g.name))
      .map((g) => {
        const n = items.filter((i) => i.variant_group_id === g.variant_group_id).length;
        return row(
          'variant_group',
          g.variant_group_id,
          g.name,
          `${categoryName(g.category_id)} · ${fill(t('size_groups.n_sizes'), { n: String(n) })}`,
        );
      });
  else
    rows = categories.flatMap((c) => {
      const inCategory = items.filter((i) => i.category_id === c.category_id && match(i.name)).sort(bySortThenName);
      if (inCategory.length === 0) return [];
      return [
        <div key={`h-${c.category_id}`} className="pos-target__group">
          {c.name}
        </div>,
        ...inCategory.map((i) => {
          const group =
            i.variant_group_id === null ? undefined : menu.variant_groups.find((g) => g.variant_group_id === i.variant_group_id);
          return row('item', i.item_id, i.name, group === undefined ? c.name : fill(t('applies.in_size_group'), { name: group.name }));
        }),
      ];
    });

  return (
    <div className="pos-scrim">
      <div
        ref={box}
        className={`pos-dialog pos-dialog--form pos-dialog--wide${phone ? ' pos-dialog--full' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-applies-to=""
      >
        <div className="pos-dialog__head">
          <div>
            <h2 className="pos-dialog__title" id={titleId}>
              {fill(t('applies.title'), { group: groupName })}
            </h2>
            <p className="pos-note pos-cgdialog__rule">{t('choice_group.rule')}</p>
          </div>
          <button type="button" className="pos-btn" aria-label={t('common.close')} onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
        <label className="pos-input-affix pos-cgdialog__search">
          <span>
            <Icon name="search" />
          </span>
          <input
            className="pos-input"
            type="search"
            name="applies_q"
            placeholder={t('applies.search')}
            aria-label={t('applies.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <Segmented<Kind>
          label={t('choice_group.applies')}
          value={tab}
          onChange={setTab}
          options={[
            {
              value: 'category',
              label: t('applies.tab_categories'),
              count: categories.length,
            },
            {
              value: 'variant_group',
              label: t('applies.tab_size_groups'),
              count: sizeGroups.length,
            },
            {
              value: 'item',
              label: t('applies.tab_items'),
              count: items.length,
            },
          ]}
        />
        <div className="pos-dialog__scroll">
          {rows}
          {error !== null && onRetry !== undefined && <MenuRetry error={error} onRetry={onRetry} />}
          {tab === 'item' && loading && (
            <div className="pos-progress-line pos-cgdialog__loading" role="status">
              <span className="pos-spin" />
              {t('applies.loading')}
            </div>
          )}
        </div>
        <div className="pos-strip" data-strip="">
          <Icon name="check" />
          <span>{fill(t('applies.strip'), { used: String(used), off: String(off) })}</span>
          {!phone && <span className="pos-note">{t('applies.saved_note')}</span>}
        </div>
        <div className="pos-dialog__footer">
          <button type="button" className="pos-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="pos-btn pos-btn--primary" onClick={() => onDone(draft)}>
            {t('applies.done')}
          </button>
        </div>
      </div>
    </div>
  );
}
