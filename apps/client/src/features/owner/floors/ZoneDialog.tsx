import { useEffect, useState } from 'react';
import type { CloudAdmin, CloudError, CreateZoneBody, MenuItem, PatchZoneBody, Station, ZoneSummary } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { useCloudDown } from '../cloud';
import { errorText, isKeyMismatch, issueMessages, useIdempotencyKey } from '../form';
import { useDirtyForm, useLeave } from '../guard';

// 01a v2.2 / v2.3 §8.1, §6.6a, §6.6b (02a A-1, 02b A-1): one zone — name, position, the items served from
// the zone (each with the station that makes it there) and the zone stock items (each with a low-stock
// threshold). The two lists are replace lists: a list is sent only when it changed (absent = keep), and an
// emptied list is sent as [] (clear). The floors list does not carry the lists, so an existing zone's lists
// are read with a PATCH that changes nothing (S26: it writes nothing and answers the stored zone).
interface RouteRow {
  item_id: string;
  station_id: string;
}
interface StockRow {
  item_id: string;
  threshold: string;
}

const INT_RE = /^[0-9]+$/;
const sameRoutes = (a: readonly RouteRow[], b: readonly RouteRow[]) => JSON.stringify(a) === JSON.stringify(b);
const sameStock = (a: readonly StockRow[], b: readonly StockRow[]) => JSON.stringify(a) === JSON.stringify(b);

export function ZoneDialog({
  api,
  branchId,
  floor,
  zone,
  onSaved,
  onArchive,
  onRestore,
  onClose,
}: {
  api: CloudAdmin;
  branchId: string;
  floor: { floor_id: string; name: string };
  zone: ZoneSummary | null;
  onSaved: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onClose: () => void;
}) {
  const archived = zone !== null && zone.archived_at !== null;
  const zoneId = zone?.zone_id;
  const storedName = zone?.name;
  const key = useIdempotencyKey();
  const [name, setName] = useState(zone?.name ?? '');
  const [sort, setSort] = useState(zone === null ? '' : String(zone.sort_order));
  const [items, setItems] = useState<MenuItem[] | null>(null);
  const [stations, setStations] = useState<Station[] | null>(null);
  const [base, setBase] = useState<{ routes: RouteRow[]; stock: StockRow[] } | null>(zone === null || archived ? { routes: [], stock: [] } : null);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const down = useCloudDown(api);
  const leave = useLeave();

  useEffect(() => {
    if (archived) return;
    let live = true;
    void (async () => {
      const [menu, station, stored] = await Promise.all([
        api.getMenu({ limit: 200 }),
        api.listStations(branchId),
        zoneId === undefined || storedName === undefined ? Promise.resolve(null) : api.patchZone(branchId, zoneId, { name: storedName }),
      ]);
      if (!live) return;
      const failed = [menu, station, stored].find((r) => r !== null && !r.ok);
      if (failed !== undefined && failed !== null && !failed.ok) {
        setLoadError(errorText(failed.error));
        return;
      }
      if (menu.ok) setItems(menu.data.items);
      if (station.ok) setStations(station.data.stations);
      if (stored !== null && stored.ok) {
        const loaded = {
          routes: stored.data.zone.routes.map((r) => ({ item_id: r.item_id, station_id: r.station_id })),
          stock: stored.data.zone.stock_items.map((s) => ({ item_id: s.item_id, threshold: String(s.threshold) })),
        };
        setBase(loaded);
        setRoutes(loaded.routes);
        setStock(loaded.stock);
      }
    })();
    return () => {
      live = false;
    };
    // A reload of the floors list hands over a new `zone` object; only another zone starts the read again.
  }, [api, branchId, zoneId, archived]);

  const ready = archived || (items !== null && stations !== null && base !== null);
  const itemName = (id: string) => items?.find((i) => i.item_id === id)?.name ?? id;
  const activeStations = (stations ?? []).filter((s) => s.archived_at === null);
  // Only an active item that is sold at this branch can be named (AD-15); a zone stock item must also be a
  // piece item that is not weighed (§6.6a, AD-6).
  const sold = (items ?? []).filter((i) => i.archived_at === null && i.routes.some((r) => r.branch_id === branchId));
  const routeChoices = sold.filter((i) => !routes.some((r) => r.item_id === i.item_id));
  const stockChoices = sold.filter((i) => i.sale_unit === 'piece' && !i.requires_weighing && !stock.some((s) => s.item_id === i.item_id));

  const trimmed = name.trim();
  const sortValid = sort.trim() === '' ? zone === null : /^-?[0-9]+$/.test(sort.trim());
  const thresholdsValid = stock.every((s) => INT_RE.test(s.threshold.trim()) && Number(s.threshold.trim()) <= 5000);
  const routesChanged = base !== null && !sameRoutes(routes, base.routes);
  const stockChanged = base !== null && !sameStock(stock.map((s) => ({ ...s, threshold: s.threshold.trim() })), base.stock);
  const nameChanged = zone === null || trimmed !== zone.name;
  const sortChanged = zone === null ? sort.trim() !== '' : sort.trim() !== String(zone.sort_order);
  const changed = [
    ...(nameChanged && (zone !== null || trimmed !== '') ? [t('zones.name').toLowerCase()] : []),
    ...(sortChanged ? [t('floors.position').toLowerCase()] : []),
    ...(routesChanged ? [t('zones.routes_title').toLowerCase()] : []),
    ...(stockChanged ? [t('zones.stock_title').toLowerCase()] : []),
  ];
  useDirtyForm(changed.length === 0 ? null : { name: zone?.name ?? t('zones.new'), fields: changed });

  const stockBody = () => stock.map((s) => ({ item_id: s.item_id, threshold: Number(s.threshold.trim()) }));

  function shown(err: CloudError) {
    const found = issueMessages(err);
    if (Object.keys(found).length > 0) setIssues(found);
    else setError(errorText(err));
  }

  async function save() {
    setError(null);
    setIssues({});
    if (trimmed.length < 1 || trimmed.length > 40 || !sortValid || !thresholdsValid || routes.some((r) => r.station_id === '')) {
      setError(t('zones.invalid'));
      return;
    }
    setBusy(true);
    let result: Awaited<ReturnType<CloudAdmin['createZone']>>;
    if (zone === null) {
      const body: CreateZoneBody = { floor_id: floor.floor_id, name: trimmed };
      if (sort.trim() !== '') body.sort_order = Number(sort.trim());
      if (routes.length > 0) body.routes = routes;
      if (stock.length > 0) body.stock_items = stockBody();
      result = await api.createZone(branchId, body, key.key);
    } else {
      const body: PatchZoneBody = {};
      if (trimmed !== zone.name) body.name = trimmed;
      if (sortChanged) body.sort_order = Number(sort.trim());
      if (routesChanged) body.routes = routes;
      if (stockChanged) body.stock_items = stockBody();
      if (Object.keys(body).length === 0) {
        setBusy(false);
        onClose();
        return;
      }
      result = await api.patchZone(branchId, zone.zone_id, body);
    }
    setBusy(false);
    if (result.ok) {
      key.renew();
      onSaved();
      return;
    }
    if (isKeyMismatch(result.error)) key.renew();
    shown(result.error);
  }

  const updateRoute = (itemId: string, patch: Partial<RouteRow>) =>
    setRoutes(routes.map((r) => (r.item_id === itemId ? { ...r, ...patch } : r)));
  const updateStock = (itemId: string, patch: Partial<StockRow>) =>
    setStock(stock.map((s) => (s.item_id === itemId ? { ...s, ...patch } : s)));
  const rowIssue = (list: 'routes' | 'stock_items', index: number) =>
    Object.entries(issues).find(([field]) => field.startsWith(`${list}.${index}.`))?.[1];

  return (
    <Dialog
      title={zone === null ? fill(t('zones.add_to'), { floor: floor.name }) : fill(t('zones.edit'), { name: zone.name })}
      onClose={() => leave(onClose)}
      footer={
        <>
          <button type="button" className="pos-btn" onClick={() => leave(onClose)}>
            {t('common.cancel')}
          </button>
          {archived ? (
            <BusyButton busy={false} primary disabled={down} onClick={onRestore}>
              {t('owner.common.restore')}
            </BusyButton>
          ) : (
            <BusyButton busy={busy} primary disabled={down || !ready} onClick={() => void save()}>
              {t('zones.save')}
            </BusyButton>
          )}
        </>
      }
    >
      {loadError !== null && <Banner tone="danger" text={loadError} />}
      <div className="pos-grid">
        <label className={`pos-field${issues['name'] === undefined ? '' : ' pos-field--error'}`}>
          <span className="pos-field__label">{t('zones.name')}</span>
          <input className="pos-input" name="name" value={name} disabled={archived} onChange={(e) => setName(e.target.value)} />
          {issues['name'] !== undefined && <span className="pos-field__error">{issues['name']}</span>}
        </label>
        <label className="pos-field">
          <span className="pos-field__label">{t('floors.position')}</span>
          <input
            className="pos-input pos-input--mono"
            name="sort_order"
            inputMode="numeric"
            value={sort}
            disabled={archived}
            onChange={(e) => setSort(e.target.value)}
          />
          <span className="pos-field__help">{t('floors.position_help')}</span>
        </label>
      </div>
      {!ready && loadError === null && <Skeleton lines={3} />}
      {ready && !archived && (
        <>
          <section className="pos-stack" data-zone-list="routes">
            <div className="pos-section__head pos-section__head--sub">
              <h3>{t('zones.routes_title')}</h3>
              <p>{t('zones.routes_help')}</p>
            </div>
            {routes.map((row, index) => (
              <div key={row.item_id} className="pos-row" data-zone-route={row.item_id}>
                <strong>{itemName(row.item_id)}</strong>
                <select
                  className="pos-select"
                  name="station_id"
                  aria-label={fill(t('zones.station_for'), { item: itemName(row.item_id) })}
                  value={row.station_id}
                  onChange={(e) => updateRoute(row.item_id, { station_id: e.target.value })}
                >
                  {activeStations.map((s) => (
                    <option key={s.station_id} value={s.station_id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="pos-btn" onClick={() => setRoutes(routes.filter((r) => r.item_id !== row.item_id))}>
                  {t('zones.remove')}
                </button>
                {rowIssue('routes', index) !== undefined && <span className="pos-field__error">{rowIssue('routes', index)}</span>}
              </div>
            ))}
            <label className="pos-field">
              <span className="pos-field__label">{t('zones.add_item')}</span>
              <select
                className="pos-select"
                name="route_add"
                value=""
                onChange={(e) => {
                  const first = activeStations[0]?.station_id ?? '';
                  if (e.target.value !== '') setRoutes([...routes, { item_id: e.target.value, station_id: first }]);
                }}
              >
                <option value="">{t('zones.pick_item')}</option>
                {routeChoices.map((i) => (
                  <option key={i.item_id} value={i.item_id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <section className="pos-stack" data-zone-list="stock">
            <div className="pos-section__head pos-section__head--sub">
              <h3>{t('zones.stock_title')}</h3>
              <p>{t('zones.stock_help')}</p>
            </div>
            {stock.map((row, index) => (
              <div key={row.item_id} className="pos-row" data-zone-stock={row.item_id}>
                <strong>{itemName(row.item_id)}</strong>
                <label className="pos-field">
                  <span className="pos-field__label">{t('zones.threshold')}</span>
                  <input
                    className="pos-input pos-input--mono"
                    name="threshold"
                    inputMode="numeric"
                    value={row.threshold}
                    onChange={(e) => updateStock(row.item_id, { threshold: e.target.value })}
                  />
                </label>
                <button type="button" className="pos-btn" onClick={() => setStock(stock.filter((s) => s.item_id !== row.item_id))}>
                  {t('zones.remove')}
                </button>
                {!INT_RE.test(row.threshold.trim()) || Number(row.threshold.trim()) > 5000 ? (
                  <span className="pos-field__error">{t('zones.threshold_range')}</span>
                ) : (
                  rowIssue('stock_items', index) !== undefined && <span className="pos-field__error">{rowIssue('stock_items', index)}</span>
                )}
              </div>
            ))}
            <label className="pos-field">
              <span className="pos-field__label">{t('zones.add_stock')}</span>
              <select
                className="pos-select"
                name="stock_add"
                value=""
                onChange={(e) => {
                  if (e.target.value !== '') setStock([...stock, { item_id: e.target.value, threshold: '0' }]);
                }}
              >
                <option value="">{t('zones.pick_item')}</option>
                {stockChoices.map((i) => (
                  <option key={i.item_id} value={i.item_id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
          </section>
        </>
      )}
      {error !== null && <Banner tone="danger" text={error} />}
      {Object.keys(issues).length > 0 && Object.keys(issues).every((f) => !f.startsWith('routes.') && !f.startsWith('stock_items.') && f !== 'name') && (
        <Banner tone="danger" text={Object.values(issues).join(' ')} />
      )}
      {zone !== null && !archived && (
        <div className="pos-dialog__danger">
          <div className="pos-section__head">
            <strong>{t('zones.archive')}</strong>
            <span>{t('zones.archive_body')}</span>
          </div>
          <button type="button" className="pos-btn pos-btn--danger" disabled={down} onClick={onArchive}>
            {t('owner.common.archive')}
          </button>
        </div>
      )}
    </Dialog>
  );
}
