import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CloudAdmin, StockItem, StockItemKind } from '../../../api/cloud-admin';
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
import { menuCostText } from './inventory';
import { drawerText, loadStations, unitWord, type StationsByBranch } from './stock';

// 08a §8.1 (C-8): tabs Prepared · Ingredients · Packets (the §6.1 kind query).
const KINDS: readonly StockItemKind[] = ['prepared', 'ingredient', 'packet'];

// §8.1 Menu cost: display_per ("Rs 1,500 / kg", "< Rs 0.01 / piece"); none → "No price" in the warning style, never "Rs 0" (I7).
export function MenuCostCell({ cost }: { cost: StockItem['menu_cost'] }) {
  return cost === null ? (
    <span className="pos-chip pos-chip--warn" data-menu-cost="">
      <Icon name="alert" />
      {t('stock_inv.no_price')}
    </span>
  ) : (
    <span className="num" data-menu-cost="">
      {menuCostText(cost)}
    </span>
  );
}

// 01c-S06 (§8 "Views", §6.6; Q12): Stock item · Counted in · Used by (dish + amount) · Counted at (read-only
// "Branch: Station" chips; a warn chip when no branch counts it). Search matches the name and the dishes' names;
// ⋯ "Show archived" lists status=archived. The whole row opens the form; read-only owners get no "New".
// 08a §8.1: one tab per kind; columns name, code, stock unit, A-item, Menu cost (+ 01c's Used by / Counted at on Prepared);
// the branch picked on the branch picker (App) is the menu cost's branch_id, changeable here ("Every branch" = none).
export function StockItemList({
  api,
  branchIds,
  branchId = null,
  onBranch,
}: {
  api: CloudAdmin;
  branchIds: readonly string[];
  branchId?: string | null;
  onBranch?: (branchId: string) => void;
}) {
  const [data, setData] = useState<{ can_edit_tenant: boolean; stock_items: StockItem[] } | null>(null);
  const [stations, setStations] = useState<StationsByBranch>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [kind, setKind] = useState<StockItemKind>('prepared');
  const [costBranch, setCostBranch] = useState<string | null>(branchId !== null && branchIds.includes(branchId) ? branchId : null);
  const prepared = kind === 'prepared';
  const phone = usePhone();
  const branchName = useBranchName();

  // Only the latest read's answer is shown, so toggling "Show archived" mid-read never shows the older list.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    const result = await api.listStockItems({
      ...(archived ? { status: 'archived' as const } : {}),
      kind,
      ...(costBranch === null ? {} : { branch_id: costBranch }),
    });
    if (request !== latest.current) return;
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else setError(errorText(result.error));
  }, [api, archived, kind, costBranch]);

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
  const pageHref = (s: StockItem) => `${href(s)}/inventory`;

  const newButton = (label: string) =>
    canEdit && (
      // 08a §8.2: a New from the Ingredients / Packets tab opens the form with that kind.
      <a className="pos-btn pos-btn--primary" href={kind === 'prepared' ? '#/stock-items/new' : `#/stock-items/new?kind=${kind}`}>
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
  const aItem = (s: StockItem) =>
    s.is_a_item && (
      <span className="pos-chip pos-chip--accent" data-a-item="">
        {t('stock_inv.a_item')}
      </span>
    );
  const cost = (s: StockItem) => (
    <a href={pageHref(s)} aria-label={fill(t('stock_inv.open_named'), { name: s.name })}>
      <MenuCostCell cost={s.menu_cost} />
    </a>
  );
  const tabs = (
    <div className="pos-tabs" role="tablist" aria-label={t('stock_items.tab_label')}>
      {KINDS.map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          className="pos-seg__opt"
          aria-selected={k === kind}
          aria-pressed={k === kind}
          onClick={() => {
            if (k === kind) return;
            setData(null);
            setKind(k);
          }}
        >
          {t(`stock_items.tab_${k}`)}
        </button>
      ))}
    </div>
  );
  const costFor = branchIds.length > 0 && (
    <label className="pos-row pos-appbar__branch">
      <span className="pos-field__label">{t('stock_items.col_08a_cost_for')}</span>
      <select
        className="pos-select"
        name="cost_branch"
        value={costBranch ?? ''}
        onChange={(e) => {
          const next = e.target.value === '' ? null : e.target.value;
          setCostBranch(next);
          if (next !== null) onBranch?.(next);
        }}
      >
        <option value="">{t('stock_inv.every_branch')}</option>
        {branchIds.map((id) => (
          <option key={id} value={id}>
            {branchName(id)}
          </option>
        ))}
      </select>
    </label>
  );

  let body;
  if (data === null) body = error !== null ? <Banner tone="danger" text={error} /> : <Skeleton lines={6} />;
  else if (!archived && prepared && data.stock_items.length === 0)
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
        {costFor}
        {error !== null && <Banner tone="danger" text={error} />}
        {rows.length === 0 ? (
          <ListEmpty
            icon="search"
            title={
              needle !== ''
                ? fill(t('c01.no_match'), { q: search.trim() })
                : archived
                  ? t('c01.none_archived')
                  : fill(t('stock_items.col_08a_empty_kind'), { kind: t(`stock_items.tab_${kind}`).toLowerCase() })
            }
          />
        ) : phone ? (
          <div className="pos-c01cards">
            {rows.map((s) => (
              <a key={s.stock_item_id} className="pos-pcard pos-c01card" href={href(s)} data-stock-item-id={s.stock_item_id}>
                <div className="pos-pcard__top">
                  <div>
                    <strong>{s.name}</strong>
                    <span className="sub">
                      {s.code !== null && <span className="num">{s.code} · </span>}
                      {t('stock_items.counted_in')} <span className="num">{unitWord(s.stock_unit)}</span>
                      {prepared && ` · ${usedBy(s)}`}
                    </span>
                  </div>
                  <Icon name="forward" flip />
                </div>
                <div className="pos-chips">
                  {aItem(s)}
                  <MenuCostCell cost={s.menu_cost} />
                </div>
                {prepared && countedAt(s)}
              </a>
            ))}
          </div>
        ) : (
          <ul className="pos-list pos-list--c5 pos-list--open">
            {/* The kit's 5-column list: on Prepared the code sits under the name and 01c's Used by / Counted at share a column. */}
            <li className="pos-list__head">
              <span>{t('stock_items.col_name')}</span>
              {!prepared && <span>{t('stock_items.col_08a_code')}</span>}
              <span>{t('stock_item.unit')}</span>
              <span>{t('stock_items.col_08a_cost')}</span>
              {prepared && <span>{`${t('stock_items.col_used')} · ${t('stock_items.col_at')}`}</span>}
              <span />
            </li>
            {rows.map((s) => (
              <li
                key={s.stock_item_id}
                className={`pos-list__row${archived ? ' is-archived' : ''}`}
                data-stock-item-id={s.stock_item_id}
              >
                <div className="pos-list__name">
                  <strong>{s.name}</strong>
                  {prepared && <span>{keeps(s)}</span>}
                  {prepared && s.code !== null && (
                    <span className="num" data-code="">
                      {s.code}
                    </span>
                  )}
                  {aItem(s)}
                </div>
                {!prepared && (
                  <span className="num" data-code="">
                    {s.code ?? '—'}
                  </span>
                )}
                <span className="num pos-c01unit">{unitWord(s.stock_unit)}</span>
                {cost(s)}
                {prepared && (
                  <div>
                    <span className="pos-list__muted">{usedBy(s)}</span>
                    {countedAt(s)}
                  </div>
                )}
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
      {tabs}
      {body}
    </Page>
  );
}
