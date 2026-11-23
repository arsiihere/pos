import { formatQuantity, parseQuantity } from '@pos/domain';
import type { CreateItemPriceRequest, CreateYieldRequest, ItemPriceWire, ItemUnitWire, YieldProfileWire } from '@pos/events';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { CloudAdmin, CloudError, StockItemInventoryData, StockUnit } from '../../../api/cloud-admin';
import { navigate } from '../../../app/router';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { Disclosure } from '../../../components/Disclosure';
import { Gone } from '../../../components/Gone';
import { Icon } from '../../../components/Icon';
import { Segmented } from '../../../components/Segmented';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { language, t } from '../../../i18n';
import { useBranchName } from '../branch';
import { apiCode, BackLink, referenceText } from '../c01';
import { useCloudDown } from '../cloud';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';
import { parseRupees, shownRupees } from '../money';
import { Page } from '../Shell';
import { MenuCostCell } from './StockItemList';
import { enteredLabel, enteredUnits, parseYieldPercent, unitFactor, unitSentence, yieldText, type EnteredUnit } from './inventory';
import { unitWord } from './stock';

// 08a §8.3 (C-8): the item page (#/stock-items/:id/inventory), one §6.4 read for the picked branch, three sections:
// Units (built-ins read-only, the item's current units as sentences, "Add or change a unit", history with other-base
// rows greyed), Menu cost (I12 label and help line; "Set price": Manual for every branch, or Today's market rate for
// every branch or one branch with Valid for), and Yield (ingredients only). Each write is a §6.5–§6.7 POST with the
// sheet's Idempotency-Key, then the page reads again. With can_edit_tenant false nothing is written.
const PRICE_MAX_MINOR = 1_000_000_000;
const VALID_FOR = [
  { value: '24', label: 'stock_inv.valid_1d' },
  { value: '48', label: 'stock_inv.valid_2d' },
  { value: '168', label: 'stock_inv.valid_1w' },
  { value: 'custom', label: 'stock_inv.valid_custom' },
] as const;
type ValidFor = (typeof VALID_FOR)[number]['value'];

function when(ms: number): string {
  return new Intl.DateTimeFormat(language() === 'ur' ? 'ur-PK' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(ms);
}

// The latest first (created_at, then id), as the §6.4 lists are sent.
function newestFirst<T extends { created_at: number }>(rows: readonly T[], id: (row: T) => string): T[] {
  return [...rows].sort((a, b) => b.created_at - a.created_at || (id(b) > id(a) ? 1 : id(b) < id(a) ? -1 : 0));
}

export function StockItemInventory({
  api,
  stockItemId,
  branchIds,
  branchId = null,
  onBranch,
}: {
  api: CloudAdmin;
  stockItemId: string;
  branchIds: readonly string[];
  branchId?: string | null;
  onBranch?: (branchId: string) => void;
}) {
  const [data, setData] = useState<StockItemInventoryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  const [costBranch, setCostBranch] = useState<string | null>(branchId !== null && branchIds.includes(branchId) ? branchId : null);
  const [sheet, setSheet] = useState<'unit' | 'price' | 'test' | 'yield_pct' | null>(null);
  const branchName = useBranchName();
  const down = useCloudDown(api);

  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    const result = await api.getStockItemInventory(stockItemId, costBranch === null ? {} : { branch_id: costBranch });
    if (request !== latest.current) return;
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else if (apiCode(result.error) === 'STOCK_ITEM_NOT_FOUND') setGone(true);
    else setError(errorText(result.error));
  }, [api, stockItemId, costBranch]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = <BackLink href="#/stock-items" list={t('stock_items.title')} label={t('stock_item.back_label')} />;
  if (gone) {
    return (
      <Page api={api} title={t('stock_item.title')} start={back}>
        <Gone
          title={t('stock_item.gone_title')}
          body={t('c01.gone_body')}
          back={fill(t('c01.back_to'), { list: t('stock_items.title') })}
          onBack={() => navigate('/stock-items')}
        />
      </Page>
    );
  }
  if (data === null) {
    return (
      <Page api={api} title={t('stock_item.title')} start={back}>
        {error !== null ? <Banner tone="danger" text={error} /> : <Skeleton lines={6} />}
      </Page>
    );
  }

  const item = data.stock_item;
  const canWrite = data.can_edit_tenant && item.archived_at === null && !down;
  const done = () => {
    setSheet(null);
    void load();
  };
  const edit = (
    <a className="pos-btn" href={`#/stock-items/${encodeURIComponent(item.stock_item_id)}`}>
      {t('stock_inv.edit_details')}
    </a>
  );

  return (
    <Page api={api} title={item.name} start={back} end={edit}>
      {error !== null && <Banner tone="danger" text={error} />}
      {item.archived_at !== null && <Banner tone="info" text={t('stock_item.archived_note')} />}
      <p className="pos-note" data-facts="">
        {fill(t('stock_inv.facts'), { kind: t(`stock_inv.kind_${item.kind}`), unit: unitWord(item.stock_unit) })}
        {item.code !== null && ` · ${fill(t('stock_inv.code'), { code: item.code })}`}
        {item.is_a_item && ` · ${t('stock_inv.a_item')}`}
      </p>
      <div className="pos-stack pos-c01form">
        <UnitsSection data={data} canWrite={canWrite} onAdd={() => setSheet('unit')} />
        <section className="pos-section" data-section="menu-cost">
          <div className="pos-fold__head">
            <div className="pos-section__head">
              {/* I12: "Menu cost" is the section; "Today's cost" is named only in this help line. */}
              <h2>{t('stock_inv.menu_cost_title')}</h2>
              <p>{t('stock_inv.menu_cost_help')}</p>
            </div>
          </div>
          <div className="pos-row">
            {branchIds.length > 0 && (
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
            )}
            <MenuCostCell cost={data.menu_cost} />
            {canWrite && (
              <button type="button" className="pos-btn pos-btn--primary" onClick={() => setSheet('price')}>
                <Icon name="plus" />
                {t('stock_inv.set_price')}
              </button>
            )}
          </div>
          <PriceHistory prices={data.prices} stockUnit={item.stock_unit} />
        </section>
        {item.kind === 'ingredient' && (
          <YieldSection
            active={data.active_yield}
            yields={data.yields}
            canWrite={canWrite}
            onTest={() => setSheet('test')}
            onPct={() => setSheet('yield_pct')}
          />
        )}
      </div>
      {sheet === 'unit' && <UnitSheet api={api} data={data} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === 'price' && <PriceSheet api={api} data={data} branchIds={branchIds} onClose={() => setSheet(null)} onDone={done} />}
      {(sheet === 'test' || sheet === 'yield_pct') && (
        <YieldSheet api={api} data={data} mode={sheet} onClose={() => setSheet(null)} onDone={done} />
      )}
    </Page>
  );
}

// ------------------------------------------------------------------------------------------------------- Units

function UnitsSection({ data, canWrite, onAdd }: { data: StockItemInventoryData; canWrite: boolean; onAdd: () => void }) {
  const base = data.stock_item.stock_unit;
  const sentence = (u: ItemUnitWire) => unitSentence(u.unit_name, BigInt(u.factor_num), BigInt(u.factor_den), u.base_unit);
  const current = data.units.filter((u) => u.is_current && u.base_unit === base);
  const history = newestFirst(data.units, (u) => u.unit_row_id);
  return (
    <section className="pos-section" data-section="units">
      <div className="pos-fold__head">
        <div className="pos-section__head">
          <h2>{t('stock_inv.units_title')}</h2>
          <p>{fill(t('stock_inv.units_help'), { unit: unitWord(base) })}</p>
        </div>
      </div>
      {data.builtin_units.length > 0 && (
        <div className="pos-chips" aria-label={t('stock_inv.builtin_title')}>
          {data.builtin_units.map((b) => (
            <span key={b.unit_name} className="pos-chip" data-builtin="">
              {unitSentence(b.unit_name, BigInt(b.num), BigInt(b.den), b.base, false)}
            </span>
          ))}
        </div>
      )}
      {current.length === 0 ? (
        <p className="pos-note">{t('stock_inv.no_units')}</p>
      ) : (
        <ul className="pos-list">
          {current.map((u) => (
            <li key={u.unit_row_id} className="pos-list__row" data-current-unit="">
              <div className="pos-list__name">
                <strong className="num">{sentence(u)}</strong>
                <span>{fill(t('stock_inv.by_when'), { who: u.recorded_by_name, when: when(u.created_at) })}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="pos-row">
          <button type="button" className="pos-btn" onClick={onAdd}>
            <Icon name="plus" />
            {t('stock_inv.add_unit')}
          </button>
        </div>
      )}
      {history.length > 0 && (
        <Disclosure title={t('stock_inv.unit_history')}>
          <ul className="pos-list">
            {history.map((u) => {
              const other = u.base_unit !== base;
              return (
                <li key={u.unit_row_id} className={`pos-list__row${other ? ' is-archived' : ''}`} data-unit-row="">
                  <div className="pos-list__name">
                    <strong className="num">{sentence(u)}</strong>
                    <span>
                      {fill(t('stock_inv.by_when'), { who: u.recorded_by_name, when: when(u.created_at) })}
                      {u.note !== null && ` · ${u.note}`}
                    </span>
                  </div>
                  {other && <span className="pos-chip">{t('stock_inv.other_unit')}</span>}
                </li>
              );
            })}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

// The errors every sheet shares: a refused or lost key, archived meanwhile, the I4 / §3.3 reasons.
function sheetError(error: CloudError): { field: 'unit_name' | 'branch_id' | null; text: string } {
  if (error.kind === 'api' && error.code === 'CONFIG_REFERENCE_INVALID') {
    const field = error.details['field'];
    if (field === 'branch_id' && error.details['reason'] === 'not_found') return { field: null, text: t('errors.reference.branch_not_found') };
    if (field === 'stock_item_id' && error.details['reason'] === 'wrong_kind') return { field: null, text: t('stock_inv.wrong_kind_yield') };
    return { field: field === 'unit_name' ? 'unit_name' : null, text: referenceText(error.details) };
  }
  return { field: null, text: errorText(error) ?? '' };
}

function Sheet({
  title,
  onClose,
  busy,
  saveLabel,
  onSave,
  banner,
  children,
}: {
  title: string;
  onClose: () => void;
  busy: boolean;
  saveLabel: string;
  onSave: () => void;
  banner: string | null;
  children: ReactNode;
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="pos-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <BusyButton primary busy={busy} onClick={onSave}>
            {saveLabel}
          </BusyButton>
        </>
      }
    >
      {banner !== null && <Banner tone="danger" text={banner} />}
      <div className="pos-stack">{children}</div>
    </Dialog>
  );
}

function TextInput({
  label,
  name,
  value,
  onChange,
  error,
  help,
  affix,
  numeric = false,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  help?: string;
  affix?: string;
  numeric?: boolean;
}) {
  const input = (
    <input
      className={`pos-input${numeric ? ' pos-input--mono' : ''}`}
      name={name}
      inputMode={numeric ? 'decimal' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
  return (
    <label className={`pos-field${error !== undefined ? ' pos-field--error' : ''}`}>
      <span className="pos-field__label">{label}</span>
      {affix === undefined ? (
        input
      ) : (
        <span className="pos-input-affix">
          {input}
          <span>{affix}</span>
        </span>
      )}
      {error !== undefined ? <span className="pos-field__error">{error}</span> : help !== undefined && <span className="pos-field__help">{help}</span>}
    </label>
  );
}

const UNIT_NAME_RE = /^[a-z0-9 ._-]{1,20}$/;

// §6.5 "Add or change a unit": name + "= N kg / g / L / ml / piece"; the client turns kg / L into g / ml and the
// decimals into num / den ("1 l = 0.92 kg" sends 920 / 1). A name already used gets a new current row (I4).
function UnitSheet({ api, data, onClose, onDone }: { api: CloudAdmin; data: StockItemInventoryData; onClose: () => void; onDone: () => void }) {
  const base = data.stock_item.stock_unit;
  const options = enteredUnits(base);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [entered, setEntered] = useState<EnteredUnit>(options[0]!);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ name?: string; amount?: string }>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { key, renew } = useIdempotencyKey();

  const unitName = name.trim().toLowerCase();
  const factor = unitFactor(amount, entered);
  const preview =
    unitName !== '' && factor !== null ? unitSentence(unitName, BigInt(factor.factor_num), BigInt(factor.factor_den), base) : null;

  async function save() {
    const found: { name?: string; amount?: string } = {};
    // I4: not the item's own stock unit, nor a built-in on that base (it already resolves).
    if (!UNIT_NAME_RE.test(unitName)) found.name = t('stock_inv.unit_name_invalid');
    else if (unitName === base || data.builtin_units.some((b) => b.unit_name === unitName)) found.name = fill(t('stock_inv.unit_known'), { name: unitName });
    if (factor === null) found.amount = fill(t('stock_inv.unit_amount_invalid'), { unit: t(`stock_unit.${base}`) });
    setErrors(found);
    setBanner(null);
    if (Object.keys(found).length > 0 || factor === null) return;
    setBusy(true);
    const result = await api.createItemUnit(
      data.stock_item.stock_item_id,
      { unit_name: unitName, ...factor, ...(note.trim() === '' ? {} : { note: note.trim() }) },
      key,
    );
    setBusy(false);
    if (result.ok) {
      renew();
      onDone();
      return;
    }
    if (isKeyMismatch(result.error)) renew();
    if (apiCode(result.error) === 'VALIDATION_FAILED') setErrors({ name: t('stock_inv.unit_name_invalid') });
    else setBanner(sheetError(result.error).text);
  }

  return (
    <Sheet title={t('stock_inv.add_unit')} onClose={onClose} busy={busy} saveLabel={t('stock_inv.save_unit')} onSave={() => void save()} banner={banner}>
      <TextInput label={t('stock_inv.unit_name')} name="unit_name" value={name} onChange={setName} error={errors.name} help={t('stock_inv.unit_name_help')} />
      <div className="pos-grid">
        <TextInput label={t('stock_inv.unit_amount')} name="unit_amount" value={amount} onChange={setAmount} error={errors.amount} numeric />
        <label className="pos-field">
          <span className="pos-field__label">{t('stock_inv.unit_in')}</span>
          <select className="pos-select" name="unit_base" value={entered} onChange={(e) => setEntered(e.target.value as EnteredUnit)}>
            {options.map((u) => (
              <option key={u} value={u}>
                {enteredLabel(u)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {preview !== null && (
        <p className="pos-note num" data-unit-preview="">
          {preview}
        </p>
      )}
      <TextInput label={t('stock_inv.note')} name="note" value={note} onChange={setNote} />
    </Sheet>
  );
}

// -------------------------------------------------------------------------------------------------- Menu cost

function PriceHistory({ prices, stockUnit }: { prices: readonly ItemPriceWire[]; stockUnit: StockUnit }) {
  const branchName = useBranchName();
  const rows = newestFirst(prices, (p) => p.price_id);
  if (rows.length === 0) return <p className="pos-note">{t('stock_inv.no_prices')}</p>;
  return (
    <>
      <h3>{t('stock_inv.price_history')}</h3>
      <ul className="pos-list">
        {rows.map((p) => {
          // I7: a price in another stock unit no longer counts (it counts again if the unit changes back, m-6).
          const other = p.stock_unit !== stockUnit;
          const details = [
            t(p.kind === 'manual' ? 'stock_inv.kind_manual' : 'stock_inv.kind_market'),
            p.branch_id === null ? t('stock_inv.every_branch') : branchName(p.branch_id),
            fill(t('stock_inv.by_when'), { who: p.recorded_by_name, when: when(p.created_at) }),
            ...(p.valid_until_at === null ? [] : [fill(t('stock_inv.valid_until'), { when: when(p.valid_until_at) })]),
            ...(p.note === null ? [] : [p.note]),
          ];
          return (
            <li key={p.price_id} className={`pos-list__row${other ? ' is-archived' : ''}`} data-price-row="">
              <div className="pos-list__name">
                <strong className="num">{fill(t('stock_inv.price_row'), { amount: shownRupees(p.price_minor), unit: p.unit_name })}</strong>
                <span>{details.join(' · ')}</span>
              </div>
              {other && <span className="pos-chip">{t('stock_inv.other_unit')}</span>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// §6.6 "Set price": Manual (every branch, no validity) or Today's market rate (every branch or one; Valid for 1 day
// by default, 2 days, 1 week or custom hours up to 720). The unit list is what resolveUnit accepts (I5): the stock
// unit, its built-ins and the item's current units.
function PriceSheet({
  api,
  data,
  branchIds,
  onClose,
  onDone,
}: {
  api: CloudAdmin;
  data: StockItemInventoryData;
  branchIds: readonly string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const base = data.stock_item.stock_unit;
  const builtins = data.builtin_units.map((b) => b.unit_name);
  const own = data.units.filter((u) => u.is_current && u.base_unit === base).map((u) => u.unit_name);
  // The big built-in (kg, l) first for g / ml items, as prices are quoted; then the stock unit itself.
  const big = builtins.filter((u) => u === 'kg' || u === 'l');
  const unitNames = [...new Set([...big, base, ...builtins, ...own])];
  const branchName = useBranchName();
  const [kind, setKind] = useState<'manual' | 'market_rate'>('manual');
  const [branch, setBranch] = useState('');
  const [validFor, setValidFor] = useState<ValidFor>('24');
  const [hours, setHours] = useState('');
  const [unitName, setUnitName] = useState(unitNames[0] ?? base);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ hours?: string; amount?: string; unit_name?: string }>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { key, renew } = useIdempotencyKey();

  const unitLabel = (u: string) => (u === base ? t(`stock_unit.${base}`) : u === 'l' ? t('quantity.l') : u);

  async function save() {
    const found: typeof errors = {};
    const price = parseRupees(amount);
    if (!price.ok || price.value < 1 || price.value > PRICE_MAX_MINOR) found.amount = t('stock_inv.price_invalid');
    let validHours = Number(validFor);
    if (kind === 'market_rate' && validFor === 'custom') {
      validHours = /^[0-9]{1,3}$/.test(hours.trim()) ? Number(hours.trim()) : 0;
      if (validHours < 1 || validHours > 720) found.hours = t('stock_inv.valid_hours_invalid');
    }
    setErrors(found);
    setBanner(null);
    if (Object.keys(found).length > 0 || !price.ok) return;
    const extra = note.trim() === '' ? {} : { note: note.trim() };
    const body: CreateItemPriceRequest =
      kind === 'manual'
        ? { kind, unit_name: unitName, price_minor: price.value, ...extra }
        : { kind, branch_id: branch === '' ? null : branch, valid_for_hours: validHours, unit_name: unitName, price_minor: price.value, ...extra };
    setBusy(true);
    const result = await api.createItemPrice(data.stock_item.stock_item_id, body, key);
    setBusy(false);
    if (result.ok) {
      renew();
      onDone();
      return;
    }
    if (isKeyMismatch(result.error)) renew();
    const shown = sheetError(result.error);
    if (shown.field === 'unit_name') setErrors({ unit_name: shown.text });
    else setBanner(shown.text);
  }

  return (
    <Sheet title={t('stock_inv.set_price')} onClose={onClose} busy={busy} saveLabel={t('stock_inv.save_price')} onSave={() => void save()} banner={banner}>
      <div className="pos-field">
        <span className="pos-field__label">{t('stock_inv.price_kind')}</span>
        <Segmented<'manual' | 'market_rate'>
          label={t('stock_inv.price_kind')}
          block
          value={kind}
          onChange={setKind}
          options={[
            { value: 'manual', label: t('stock_inv.kind_manual') },
            { value: 'market_rate', label: t('stock_inv.kind_market') },
          ]}
        />
        <span className="pos-field__help">{t(kind === 'manual' ? 'stock_inv.manual_help' : 'stock_inv.market_help')}</span>
      </div>
      {kind === 'market_rate' && (
        <>
          <label className="pos-field">
            <span className="pos-field__label">{t('stock_inv.price_branch')}</span>
            <select className="pos-select" name="branch_id" value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">{t('stock_inv.every_branch')}</option>
              {branchIds.map((id) => (
                <option key={id} value={id}>
                  {branchName(id)}
                </option>
              ))}
            </select>
          </label>
          <div className="pos-field" data-valid-for="">
            <span className="pos-field__label">{t('stock_inv.valid_for')}</span>
            <Segmented<ValidFor>
              label={t('stock_inv.valid_for')}
              block
              value={validFor}
              onChange={setValidFor}
              options={VALID_FOR.map((o) => ({ value: o.value, label: t(o.label) }))}
            />
          </div>
          {validFor === 'custom' && (
            <TextInput label={t('stock_inv.valid_hours')} name="valid_for_hours" value={hours} onChange={setHours} error={errors.hours} numeric />
          )}
        </>
      )}
      <div className="pos-grid">
        <label className={`pos-field${errors.unit_name !== undefined ? ' pos-field--error' : ''}`}>
          <span className="pos-field__label">{t('stock_inv.price_unit')}</span>
          <select className="pos-select" name="unit_name" value={unitName} onChange={(e) => setUnitName(e.target.value)}>
            {unitNames.map((u) => (
              <option key={u} value={u}>
                {unitLabel(u)}
              </option>
            ))}
          </select>
          {errors.unit_name !== undefined && <span className="pos-field__error">{errors.unit_name}</span>}
        </label>
        <TextInput label={t('stock_inv.price_amount')} name="price" value={amount} onChange={setAmount} error={errors.amount} affix={t('owner.menu.rupees')} numeric />
      </div>
      <TextInput label={t('stock_inv.note')} name="note" value={note} onChange={setNote} />
    </Sheet>
  );
}

// ------------------------------------------------------------------------------------------------------ Yield

function YieldSection({
  active,
  yields,
  canWrite,
  onTest,
  onPct,
}: {
  active: YieldProfileWire | null;
  yields: readonly YieldProfileWire[];
  canWrite: boolean;
  onTest: () => void;
  onPct: () => void;
}) {
  const rows = newestFirst(yields, (y) => y.yield_profile_id);
  const test = (y: YieldProfileWire) =>
    y.test_ap_qty === null || y.test_ep_qty === null || y.test_unit === null
      ? null
      : fill(t('stock_inv.yield_test_row'), {
          ap: formatQuantity(Number(y.test_ap_qty), y.test_unit),
          ep: formatQuantity(Number(y.test_ep_qty), y.test_unit),
        });
  return (
    <section className="pos-section" data-section="yield">
      <div className="pos-fold__head">
        <div className="pos-section__head">
          <h2>{t('stock_inv.yield_title')}</h2>
          <p>{t('stock_inv.yield_help')}</p>
        </div>
      </div>
      <div className="pos-row">
        {active === null ? (
          <span className="pos-note">{t('stock_inv.no_yield')}</span>
        ) : (
          <strong className="num" data-active-yield="">
            {yieldText(active.yield_bp)}
          </strong>
        )}
        {canWrite && (
          <>
            <button type="button" className="pos-btn" onClick={onTest}>
              {t('stock_inv.record_test')}
            </button>
            <button type="button" className="pos-btn" onClick={onPct}>
              {t('stock_inv.set_yield')}
            </button>
          </>
        )}
      </div>
      {rows.length > 0 && (
        <Disclosure title={t('stock_inv.yield_history')}>
          <ul className="pos-list">
            {rows.map((y) => (
              <li key={y.yield_profile_id} className="pos-list__row" data-yield-row="">
                <div className="pos-list__name">
                  <strong className="num">{yieldText(y.yield_bp)}</strong>
                  <span>
                    {[test(y), fill(t('stock_inv.by_when'), { who: y.recorded_by_name, when: when(y.created_at) }), y.note]
                      .filter((x): x is string => x !== null)
                      .join(' · ')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}

// §6.7: "Record a test" (AP and EP in the stock unit, typed as kg / L or pieces) or "Set yield %" (one form per POST).
function YieldSheet({
  api,
  data,
  mode,
  onClose,
  onDone,
}: {
  api: CloudAdmin;
  data: StockItemInventoryData;
  mode: 'test' | 'yield_pct';
  onClose: () => void;
  onDone: () => void;
}) {
  const unit = data.stock_item.stock_unit;
  // §8.3 (m-15): AP / EP typed as kg / g, L / ml or pieces; sent in the stock unit.
  const entries = enteredUnits(unit);
  const [entered, setEntered] = useState<EnteredUnit>(entries[0]!);
  const [ap, setAp] = useState('');
  const [ep, setEp] = useState('');
  const [pct, setPct] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { key, renew } = useIdempotencyKey();

  async function save() {
    setBanner(null);
    const extra = note.trim() === '' ? {} : { note: note.trim() };
    let body: CreateYieldRequest;
    if (mode === 'test') {
      // kg / L: up to 3 decimals into g / ml; g, ml and pieces: whole numbers.
      const big = entered === 'kg' || entered === 'l';
      const a = parseQuantity(ap, big ? unit : 'piece');
      const e = parseQuantity(ep, big ? unit : 'piece');
      if (!a.ok || !e.ok || a.value < 1 || e.value < 1) {
        setError(t('stock_inv.test_invalid'));
        return;
      }
      // I8: the computed yield must be 0.01 % … 500 % (else the cloud answers 400).
      if (BigInt(e.value) * 2n > BigInt(a.value) * 10n) {
        setError(t('stock_inv.yield_invalid'));
        return;
      }
      body = { test_ap_qty: a.value, test_ep_qty: e.value, ...extra };
    } else {
      const bp = parseYieldPercent(pct);
      if (bp === null) {
        setError(t('stock_inv.yield_invalid'));
        return;
      }
      body = { yield_bp: bp, ...extra };
    }
    setError(undefined);
    setBusy(true);
    const result = await api.createYield(data.stock_item.stock_item_id, body, key);
    setBusy(false);
    if (result.ok) {
      renew();
      onDone();
      return;
    }
    if (isKeyMismatch(result.error)) renew();
    if (apiCode(result.error) === 'VALIDATION_FAILED') setError(t('stock_inv.yield_invalid'));
    else setBanner(sheetError(result.error).text);
  }

  const affix = enteredLabel(entered);
  return (
    <Sheet
      title={t(mode === 'test' ? 'stock_inv.record_test' : 'stock_inv.set_yield')}
      onClose={onClose}
      busy={busy}
      saveLabel={t('stock_inv.save_yield')}
      onSave={() => void save()}
      banner={banner}
    >
      {mode === 'test' ? (
        <div className="pos-grid">
          <TextInput label={t('stock_inv.test_ap')} name="test_ap_qty" value={ap} onChange={setAp} affix={affix} numeric />
          <TextInput label={t('stock_inv.test_ep')} name="test_ep_qty" value={ep} onChange={setEp} affix={affix} numeric error={error} />
          {entries.length > 1 && (
            <label className="pos-field">
              <span className="pos-field__label">{t('stock_inv.unit_in')}</span>
              <select className="pos-select" name="test_unit" value={entered} onChange={(ev) => setEntered(ev.target.value as EnteredUnit)}>
                {entries.map((u) => (
                  <option key={u} value={u}>
                    {enteredLabel(u)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : (
        <TextInput label={t('stock_inv.yield_pct_label')} name="yield_pct" value={pct} onChange={setPct} affix="%" numeric error={error} />
      )}
      <TextInput label={t('stock_inv.note')} name="note" value={note} onChange={setNote} />
    </Sheet>
  );
}
