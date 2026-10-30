import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CloudAdmin, StockItem } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { Banner } from '../../../components/Banner';
import { Icon } from '../../../components/Icon';
import { MoreMenu } from '../../../components/MoreMenu';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { useBranchName } from '../branch';
import { ListBar, ListEmpty } from '../c01';
import { errorText } from '../form';
import { Page } from '../Shell';
import { drawerText, loadStations, unitWord, type StationsByBranch } from './stock';

// 01c-S06 (§8 "Views", §6.6; Q12): Stock item · Counted in · Used by (dish + amount) · Counted at (read-only
// "Branch: Station" chips; a warn chip when no branch counts it). Search matches the name and the dishes' names;
// ⋯ "Show archived" lists status=archived. The whole row opens the form; read-only owners get no "New".
export function StockItemList({ api, branchIds }: { api: CloudAdmin; branchIds: readonly string[] }) {
  const [data, setData] = useState<{ can_edit_tenant: boolean; stock_items: StockItem[] } | null>(null);
  const [stations, setStations] = useState<StationsByBranch>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const phone = usePhone();
  const branchName = useBranchName();

  const load = useCallback(async () => {
    const result = await api.listStockItems(archived ? { status: 'archived' } : {});
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else setError(errorText(result.error));
  }, [api, archived]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let live = true;
    void loadStations(api, branchIds).then((next) => {
      if (live) setStations(next);
    });
    return () => {
      live = false;
    };
  }, [api, branchIds]);

  const stationName = useMemo(
    () => (branchId: string, stationId: string) => stations.get(branchId)?.find((s) => s.station_id === stationId)?.name ?? '',
    [stations],
  );
  const needle = search.trim().toLowerCase();
  const rows = (data?.stock_items ?? [])
    .filter(
      (s) =>
        needle === '' ||
        s.name.toLowerCase().includes(needle) ||
        s.drawers.some((d) => d.name.toLowerCase().includes(needle) || (d.variant_name ?? '').toLowerCase().includes(needle)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const canEdit = data?.can_edit_tenant === true;
  const href = (s: StockItem) => `#/stock-items/${encodeURIComponent(s.stock_item_id)}`;

  const newButton = (label: string) =>
    canEdit && (
      <a className="pos-btn pos-btn--primary" href="#/stock-items/new">
        <Icon name="plus" />
        {label}
      </a>
    );
  // Phone frames (SizeGroupsPhone, StockItemsPhone) show only New in the app bar.
  const end = (
    <>
      {!phone && (
        <MoreMenu
          label={t('stock_items.more')}
          items={[
            {
              label: archived ? t('stock_items.hide_archived') : t('stock_items.show_archived'),
              icon: 'archive',
              onSelect: () => setArchived(!archived),
            },
          ]}
        />
      )}
      {newButton(phone ? t('c01.new_short') : t('stock_items.new'))}
    </>
  );

  const usedBy = (s: StockItem) =>
    s.drawers.length === 0 ? t('stock_items.unused') : s.drawers.map((d) => drawerText(d, s.stock_unit)).join(', ');
  const countedAt = (s: StockItem) => {
    const counted = s.branches.filter((b) => b.station_id !== null);
    return (
      <div className="pos-chips">
        {counted.length === 0 ? (
          <span className="pos-chip pos-chip--warn">
            <Icon name="alert" />
            {t('stock_items.not_counted_anywhere')}
          </span>
        ) : (
          counted.map((b) => (
            <span key={b.branch_id} className="pos-chip">
              {fill(t('stock_items.at'), { branch: branchName(b.branch_id), station: stationName(b.branch_id, b.station_id ?? '') })}
            </span>
          ))
        )}
      </div>
    );
  };
  const keeps = (s: StockItem) => (s.carries_over ? t('stock_items.keeps') : t('stock_items.fresh'));

  let body;
  if (data === null) body = error !== null ? <Banner tone="danger" text={error} /> : <Skeleton lines={6} />;
  else if (!archived && data.stock_items.length === 0)
    body = (
      <ListEmpty icon="pot" title={t('stock_items.empty_title')} body={t('stock_items.empty_body')}>
        {newButton(t('stock_items.new'))}
      </ListEmpty>
    );
  else
    body = (
      <>
        <ListBar
          search={search}
          onSearch={setSearch}
          placeholder={t('stock_items.search')}
          archived={archived}
          onHideArchived={() => setArchived(false)}
          hideArchivedLabel={t('stock_items.hide_archived')}
          helper={t('stock_items.helper')}
        />
        {error !== null && <Banner tone="danger" text={error} />}
        {rows.length === 0 ? (
          <ListEmpty icon="search" title={needle === '' ? t('c01.none_archived') : fill(t('c01.no_match'), { q: search.trim() })} />
        ) : phone ? (
          <div className="pos-c01cards">
            {rows.map((s) => (
              <a key={s.stock_item_id} className="pos-pcard pos-c01card" href={href(s)} data-stock-item-id={s.stock_item_id}>
                <div className="pos-pcard__top">
                  <div>
                    <strong>{s.name}</strong>
                    <span className="sub">
                      {t('stock_items.counted_in')} <span className="num">{unitWord(s.stock_unit)}</span> · {usedBy(s)}
                    </span>
                  </div>
                  <Icon name="forward" flip />
                </div>
                {countedAt(s)}
              </a>
            ))}
          </div>
        ) : (
          <ul className="pos-list pos-list--c5 pos-list--open">
            <li className="pos-list__head">
              <span>{t('stock_items.col_name')}</span>
              <span>{t('stock_item.unit')}</span>
              <span>{t('stock_items.col_used')}</span>
              <span>{t('stock_items.col_at')}</span>
              <span />
            </li>
            {rows.map((s) => (
              <li key={s.stock_item_id} className={`pos-list__row${archived ? ' is-archived' : ''}`} data-stock-item-id={s.stock_item_id}>
                <div className="pos-list__name">
                  <strong>{s.name}</strong>
                  <span>{keeps(s)}</span>
                </div>
                <span className="num pos-c01unit">{unitWord(s.stock_unit)}</span>
                <span className="pos-list__muted">{usedBy(s)}</span>
                {countedAt(s)}
                <a className="pos-rowlink" href={href(s)} aria-label={fill(t('c01.open_named'), { name: s.name })}>
                  <Icon name="forward" flip />
                </a>
              </li>
            ))}
          </ul>
        )}
      </>
    );

  return (
    <Page api={api} title={t('stock_items.title')} end={end}>
      {body}
    </Page>
  );
}
