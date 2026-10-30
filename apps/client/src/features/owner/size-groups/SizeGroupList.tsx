import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CloudAdmin, VariantGroup } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { Banner } from '../../../components/Banner';
import { Icon } from '../../../components/Icon';
import { MoreMenu } from '../../../components/MoreMenu';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { bySortThenName, ListBar, ListEmpty, sizeLabel } from '../c01';
import { errorText } from '../form';
import { loadEveryItem, type WholeMenu } from '../menu-pages';
import { shownRupees } from '../money';
import { Page } from '../Shell';

// 01c-S08 (§8 "Views", §6.3; Q12): every size group from the menu read (archived ones behind ⋯ "Show
// archived"), searched by name, sorted by sort_order then name. Columns Size group · Category · Sizes (chips
// "Half Rs 1,150"); the whole row opens the form. Read-only owners (can_edit_tenant false) get no "New".
export function SizeGroupList({ api }: { api: CloudAdmin }) {
  const [menu, setMenu] = useState<WholeMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const phone = usePhone();

  const load = useCallback(async () => {
    const result = await loadEveryItem(api);
    if (result.ok) {
      setMenu(result.data);
      setError(null);
    } else setError(errorText(result.error));
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => new Map((menu?.items ?? []).map((item) => [item.item_id, item])), [menu]);
  const categoryName = (id: string) => menu?.categories.find((c) => c.category_id === id)?.name ?? '';
  const needle = search.trim().toLowerCase();
  const groups = (menu?.variant_groups ?? [])
    .filter((g) => (g.archived_at !== null) === archived)
    .filter((g) => needle === '' || g.name.toLowerCase().includes(needle))
    .sort(bySortThenName);
  const canEdit = menu?.can_edit_tenant === true;
  const href = (group: VariantGroup) => `#/size-groups/${encodeURIComponent(group.variant_group_id)}`;

  const newButton = (label: string) =>
    canEdit && (
      <a className="pos-btn pos-btn--primary" href="#/size-groups/new">
        <Icon name="plus" />
        {label}
      </a>
    );
  // Phone frames (SizeGroupsPhone, StockItemsPhone) show only New in the app bar.
  const end = (
    <>
      {!phone && (
        <MoreMenu
          label={t('size_groups.more')}
          items={[
            {
              label: archived ? t('size_groups.hide_archived') : t('size_groups.show_archived'),
              icon: 'archive',
              onSelect: () => setArchived(!archived),
            },
          ]}
        />
      )}
      {newButton(phone ? t('c01.new_short') : t('size_groups.new'))}
    </>
  );

  const sizes = (group: VariantGroup) =>
    group.member_ids
      .flatMap((id) => items.get(id) ?? [])
      .filter((item) => item.archived_at === null)
      .sort(bySortThenName);
  const sizeCount = (group: VariantGroup) => {
    const n = sizes(group).length;
    return n === 1 ? t('size_groups.one_size') : fill(t('size_groups.n_sizes'), { n: String(n) });
  };
  const chips = (group: VariantGroup) => (
    <div className="pos-chips">
      {sizes(group).map((item) => (
        <span key={item.item_id} className="pos-chip">
          <bdi>{sizeLabel(item)}</bdi> <span className="num">{`${t('owner.menu.rupees')} ${shownRupees(item.price_minor)}`}</span>
        </span>
      ))}
    </div>
  );

  let body;
  if (menu === null) body = error !== null ? <Banner tone="danger" text={error} /> : <Skeleton lines={6} />;
  else if (!archived && !menu.variant_groups.some((g) => g.archived_at === null))
    body = (
      <ListEmpty icon="layers" title={t('size_groups.empty_title')} body={t('size_groups.empty_body')}>
        {newButton(t('size_groups.new'))}
      </ListEmpty>
    );
  else
    body = (
      <>
        <ListBar
          search={search}
          onSearch={setSearch}
          placeholder={t('size_groups.search')}
          archived={archived}
          onHideArchived={() => setArchived(false)}
          hideArchivedLabel={t('size_groups.hide_archived')}
          helper={t('size_groups.helper')}
        />
        {error !== null && <Banner tone="danger" text={error} />}
        {groups.length === 0 ? (
          <ListEmpty icon="search" title={needle === '' ? t('c01.none_archived') : fill(t('c01.no_match'), { q: search.trim() })} />
        ) : phone ? (
          <div className="pos-c01cards">
            {groups.map((group) => (
              <a key={group.variant_group_id} className="pos-pcard pos-c01card" href={href(group)} data-group-id={group.variant_group_id}>
                <div className="pos-pcard__top">
                  <div>
                    <strong>{group.name}</strong>
                    <span className="sub">{`${categoryName(group.category_id)} · ${sizeCount(group)}`}</span>
                  </div>
                  <Icon name="forward" flip />
                </div>
                {chips(group)}
              </a>
            ))}
          </div>
        ) : (
          <ul className="pos-list pos-list--c4 pos-list--open">
            <li className="pos-list__head">
              <span>{t('size_groups.col_name')}</span>
              <span>{t('owner.item.category')}</span>
              <span>{t('size_groups.col_sizes')}</span>
              <span />
            </li>
            {groups.map((group) => (
              <li
                key={group.variant_group_id}
                className={`pos-list__row${group.archived_at !== null ? ' is-archived' : ''}`}
                data-group-id={group.variant_group_id}
              >
                <div className="pos-list__name">
                  <strong>{group.name}</strong>
                  <span>{sizeCount(group)}</span>
                </div>
                <span className="pos-list__muted">{categoryName(group.category_id)}</span>
                {chips(group)}
                <a className="pos-rowlink" href={href(group)} aria-label={fill(t('c01.open_named'), { name: group.name })}>
                  <Icon name="forward" flip />
                </a>
              </li>
            ))}
          </ul>
        )}
      </>
    );

  return (
    <Page api={api} title={t('size_groups.title')} end={end}>
      {body}
    </Page>
  );
}
