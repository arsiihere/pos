import { useCallback, useEffect, useState } from 'react';
import type { CloudAdmin, Deal, MenuItem } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { Banner } from '../../../components/Banner';
import { Icon } from '../../../components/Icon';
import { MoreMenu } from '../../../components/MoreMenu';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { useBranchName } from '../branch';
import { bySortThenName, ListBar, ListEmpty } from '../c01';
import { errorText } from '../form';
import { loadWholeMenu, type WholeMenu } from '../menu-pages';
import { shownRupees } from '../money';
import { Page } from '../Shell';
import { omissions, omissionText, partsLine } from './deals';

// 01c-S04 (§8 "Views", §6.13; Q12): Deal (+ category · tax, or the B04 warnings) · Price · Parts · Sold at
// (read-only "Branch Rs price" chips, or "Not sold anywhere yet"). The 01c-B04 warnings "Not sold at X: part N
// has no routed choice" are computed from every §6.3 menu page's routes and show only after the last page has
// loaded; until then the page says "Checking branches…" (§8, N9; test #115). ⋯ "Show archived" reads
// status=archived (AD-30 a). Read-only owners get no "New deal".
export function DealList({ api }: { api: CloudAdmin }) {
  const [data, setData] = useState<{ can_edit_tenant: boolean; deals: Deal[] } | null>(null);
  const [menu, setMenu] = useState<WholeMenu | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const phone = usePhone();
  const branchName = useBranchName();

  const load = useCallback(async () => {
    const result = await api.listDeals(archived ? { status: 'archived' } : {});
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
    void loadWholeMenu(api).then((result) => {
      if (!live) return;
      if (result.ok) setMenu(result.data);
      else setError(errorText(result.error));
    });
    return () => {
      live = false;
    };
  }, [api]);

  const items = new Map<string, MenuItem>((menu?.items ?? []).map((item) => [item.item_id, item]));
  const categoryName = (id: string) => menu?.categories.find((c) => c.category_id === id)?.name ?? '';
  const taxName = (id: string | null) =>
    id === null ? t('deals.no_tax') : (menu?.tax_classes.find((x) => x.tax_class_id === id)?.name ?? '');
  const needle = search.trim().toLowerCase();
  const rows = (data?.deals ?? []).filter((d) => needle === '' || d.name.toLowerCase().includes(needle)).sort(bySortThenName);
  const canEdit = data?.can_edit_tenant === true;
  const checking = menu === null;
  const href = (d: Deal) => `#/deals/${encodeURIComponent(d.deal_id)}`;
  const rupees = (minor: number) => `${t('owner.menu.rupees')} ${shownRupees(minor)}`;

  const newButton = (label: string) =>
    canEdit && (
      <a className="pos-btn pos-btn--primary" href="#/deals/new">
        <Icon name="plus" />
        {label}
      </a>
    );
  const end = (
    <>
      {!phone && (
        <MoreMenu
          label={t('deals.more')}
          items={[
            { label: archived ? t('deals.hide_archived') : t('deals.show_archived'), icon: 'archive', onSelect: () => setArchived(!archived) },
          ]}
        />
      )}
      {newButton(phone ? t('c01.new_short') : t('deals.new'))}
    </>
  );

  const soldAt = (d: Deal) => {
    const sold = d.branches.filter((b) => b.is_sold);
    if (sold.length === 0)
      return (
        <div className="pos-chips">
          <span className="pos-chip">
            <Icon name="x" />
            {t('deals.sold_nowhere')}
          </span>
        </div>
      );
    return (
      <div className="pos-chips">
        {sold.map((b) => (
          <span key={b.branch_id} className="pos-chip">
            {branchName(b.branch_id)} <span className="num">{rupees(b.price_minor_override ?? d.price_minor)}</span>
          </span>
        ))}
      </div>
    );
  };
  const warnings = (d: Deal) =>
    checking
      ? []
      : omissions(d, items).map((o) => (
          <span key={`${o.branchId}-${o.part}`} className="pos-chip pos-chip--warn" data-omission="">
            <Icon name="alert" />
            {omissionText(o, branchName)}
          </span>
        ));

  let body;
  if (data === null) body = error !== null ? <Banner tone="danger" text={error} /> : <Skeleton lines={6} />;
  else if (!archived && data.deals.length === 0)
    body = (
      <ListEmpty icon="tag" title={t('deals.empty_title')} body={t('deals.empty_body')}>
        {newButton(t('deals.new'))}
      </ListEmpty>
    );
  else
    body = (
      <>
        <ListBar
          search={search}
          onSearch={setSearch}
          placeholder={t('deals.search')}
          archived={archived}
          onHideArchived={() => setArchived(false)}
          hideArchivedLabel={t('deals.hide_archived')}
          helper={checking ? '' : t('deals.helper')}
        />
        {checking && (
          <span className="pos-progress-line pos-deals__checking" role="status" data-checking="">
            <span className="pos-spin" />
            {t('deals.checking')}
          </span>
        )}
        {error !== null && <Banner tone="danger" text={error} />}
        {rows.length === 0 ? (
          <ListEmpty icon="search" title={needle === '' ? t('c01.none_archived') : fill(t('c01.no_match'), { q: search.trim() })} />
        ) : phone ? (
          <div className="pos-c01cards">
            {rows.map((d) => {
              const warn = warnings(d);
              return (
                <a key={d.deal_id} className="pos-pcard pos-c01card" href={href(d)} data-deal-id={d.deal_id}>
                  <div className="pos-pcard__top">
                    <div>
                      <strong>{d.name}</strong>
                      <span className="sub"><bdi>{partsLine(d, items)}</bdi></span>
                    </div>
                    <span className="pos-list__num pos-deals__price">{rupees(d.price_minor)}</span>
                  </div>
                  {soldAt(d)}
                  {warn.length > 0 && <div className="pos-chips">{warn}</div>}
                </a>
              );
            })}
          </div>
        ) : (
          <ul className="pos-list pos-list--c5 pos-list--open pos-list--deals">
            <li className="pos-list__head">
              <span>{t('deals.col_name')}</span>
              <span>{t('deals.col_price')}</span>
              <span>{t('deals.col_parts')}</span>
              <span>{t('deals.col_sold')}</span>
              <span />
            </li>
            {rows.map((d) => {
              const warn = warnings(d);
              return (
                <li key={d.deal_id} className={`pos-list__row${archived ? ' is-archived' : ''}`} data-deal-id={d.deal_id}>
                  <div className="pos-list__name">
                    <strong>{d.name}</strong>
                    {warn.length > 0 ? (
                      <div className="pos-chips">{warn}</div>
                    ) : (
                      <span>{fill(t('deals.meta'), { category: categoryName(d.category_id), tax: taxName(d.tax_class_id) })}</span>
                    )}
                  </div>
                  <span className="pos-list__num pos-deals__price">{rupees(d.price_minor)}</span>
                  <span className="pos-list__muted"><bdi>{partsLine(d, items)}</bdi></span>
                  {soldAt(d)}
                  <a className="pos-rowlink" href={href(d)} aria-label={fill(t('c01.open_named'), { name: d.name })}>
                    <Icon name="forward" flip />
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );

  return (
    <Page api={api} title={t('deals.title')} end={end}>
      {body}
    </Page>
  );
}
