import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CloudAdmin,
  CloudError,
  CostWire,
  RecipeDetail,
  RecipeLineWire,
  RecipeVersionWire,
  SaveDraftBody,
  StockItem,
  StockItemInventoryData,
  StockUnit,
} from '../../../api/cloud-admin';
import { navigate } from '../../../app/router';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Chip } from '../../../components/Chip';
import { Gone } from '../../../components/Gone';
import { Icon } from '../../../components/Icon';
import { Skeleton } from '../../../components/Skeleton';
import { StaleBanner } from '../../../components/StaleBanner';
import { fill } from '../../../i18n/en';
import { language, t, type MessageKey } from '../../../i18n';
import { useBranchName } from '../branch';
import { apiCode, BackLink } from '../c01';
import { useCloudDown } from '../cloud';
import { errorText, issueMessages } from '../form';
import { useDirtyForm } from '../guard';
import { Page } from '../Shell';
import {
  costText,
  derivedBasis,
  lineCostText,
  liveLineCost,
  livePlateCost,
  makesText,
  measureText,
  miscPercentText,
  newDraftReason,
  parseMiscPercent,
  parseQty,
  reasonText,
  restoreReasonText,
  unitChoices,
  type LiveCost,
} from './recipes';

// 08 v1.1 Part B §8.2 (§6.2, §6.4–§6.6): the recipe editor (#/recipes/:recipe_id). Owner header; the basis fields of
// §3.2 (per_measure "per kg" / "per litre" from the frozen measure unit, per_batch "makes 160 piece"); misc allowance
// %; the lines (stock item search across kinds, quantity, a unit pick-list of the units resolveUnit accepts, AP / EP
// with the derived default shown); live line and plate cost (menu cost, I12) while typing, the cloud's own figures
// once saved; warnings; Save draft / Publish / Archive / Restore; history. Each line's units, menu cost and yield come
// from its 08a §6.4 detail read for the picked branch.

type Choice = '' | 'AP' | 'EP';
interface LineState {
  key: string;
  stock_item_id: string;
  name: string;
  kind: string;
  qty: string;
  unit_name: string;
  // '' = let the cloud derive it (B4, M-7). A saved line keeps its stored basis (`picked` false) until the owner picks.
  choice: Choice;
  picked: boolean;
  saved: RecipeLineWire | null;
}
interface FormState {
  baseQty: string;
  batchYield: string;
  misc: string;
  lines: LineState[];
}
type Inventory = ReadonlyMap<string, StockItemInventoryData>;

const MAX_SEARCH = 8;

function formOf(version: RecipeVersionWire | null): FormState {
  return {
    baseQty: version?.base_qty == null ? '1000' : String(version.base_qty),
    batchYield: version?.batch_yield_qty ?? '',
    misc: miscPercentText(version?.misc_allowance_bp ?? 500),
    lines: (version?.lines ?? []).map((l) => ({
      key: `${l.stock_item_id}`,
      stock_item_id: l.stock_item_id,
      name: l.stock_item_name,
      kind: l.kind,
      qty: l.qty,
      unit_name: l.unit_name,
      choice: l.qty_basis,
      picked: false,
      saved: l,
    })),
  };
}

function when(ms: number): string {
  return new Intl.DateTimeFormat(language() === 'ur' ? 'ur-PK' : 'en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(ms);
}

export function RecipeEditor({
  api,
  recipeId,
  branchIds,
  branchId = null,
  onBranch,
}: {
  api: CloudAdmin;
  recipeId: string;
  branchIds: readonly string[];
  branchId?: string | null;
  onBranch?: (branchId: string) => void;
}) {
  const [data, setData] = useState<RecipeDetail | null>(null);
  const [inventory, setInventory] = useState<Inventory>(new Map());
  const [stock, setStock] = useState<StockItem[]>([]);
  const [form, setForm] = useState<FormState>(() => formOf(null));
  const [dirty, setDirty] = useState(false);
  const [costBranch, setCostBranch] = useState<string | null>(branchId !== null && branchIds.includes(branchId) ? branchId : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ tone: 'danger' | 'ok'; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [stale, setStale] = useState(false);
  const [gone, setGone] = useState(false);
  const [newDraft, setNewDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const branchName = useBranchName();
  const down = useCloudDown(api);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const readInventory = useCallback(
    async (ids: readonly string[], known: Inventory): Promise<Map<string, StockItemInventoryData>> => {
      const next = new Map(known);
      const query = costBranch === null ? {} : { branch_id: costBranch };
      const results = await Promise.all(ids.filter((id) => !next.has(id)).map(async (id) => [id, await api.getStockItemInventory(id, query)] as const));
      for (const [id, result] of results) if (result.ok) next.set(id, result.data);
      return next;
    },
    [api, costBranch],
  );

  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    const [result, list] = await Promise.all([
      api.getRecipe(recipeId, costBranch === null ? {} : { branch_id: costBranch }),
      api.listStockItems({}),
    ]);
    if (request !== latest.current) return;
    if (!result.ok) {
      if (apiCode(result.error) === 'RECIPE_NOT_FOUND') setGone(true);
      else setLoadError(errorText(result.error));
      return;
    }
    const version = result.data.draft ?? result.data.published;
    const keep = dirtyRef.current;
    const ids = (version?.lines ?? []).map((l) => l.stock_item_id);
    const read = await readInventory(ids, new Map());
    if (request !== latest.current) return;
    if (list.ok && Array.isArray(list.data.stock_items)) setStock(list.data.stock_items);
    setData(result.data);
    setInventory(read);
    setLoadError(null);
    setStale(false);
    if (!keep) {
      setForm(formOf(version));
      setFieldErrors({});
    }
  }, [api, recipeId, costBranch, readInventory]);

  useEffect(() => {
    void load();
  }, [load]);

  useDirtyForm(dirty && !gone ? { name: data?.recipe.owner_name ?? t('recipe.title'), fields: [t('recipe.lines_title')] } : null);

  const back = <BackLink href="#/recipes" list={t('recipes.title')} label={t('recipe.back_label')} />;
  if (gone) {
    return (
      <Page api={api} title={t('recipe.title')} start={back}>
        <Gone title={t('recipe.gone_title')} body={t('c01.gone_body')} back={fill(t('c01.back_to'), { list: t('recipes.title') })} onBack={() => navigate('/recipes')} />
      </Page>
    );
  }
  if (data === null) {
    return (
      <Page api={api} title={t('recipe.title')} start={back}>
        {loadError !== null ? <Banner tone="danger" text={loadError} /> : <Skeleton lines={6} />}
      </Page>
    );
  }

  const recipe = data.recipe;
  const shown = data.draft ?? data.published;
  const basis = shown?.basis ?? (recipe.owner_type === 'stock_item' ? 'per_batch' : 'per_unit');
  const top = basis !== 'per_batch';
  const canWrite = data.can_edit_tenant && !down && !busy;

  function edit(next: (prev: FormState) => FormState) {
    setForm(next);
    setDirty(true);
    setBanner(null);
  }
  function editLine(index: number, change: Partial<LineState>) {
    edit((prev) => ({ ...prev, lines: prev.lines.map((l, i) => (i === index ? { ...l, ...change, picked: l.picked || change.choice !== undefined } : l)) }));
    setFieldErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`lines.${index}.`))));
  }

  const hasYield = (id: string): boolean | null => {
    const inv = inventory.get(id);
    return inv === undefined ? null : inv.active_yield !== null;
  };
  // The basis the line is costed with: the chosen one, the stored one, or the derived default (AP while unknown).
  const lineBasis = (l: LineState): 'AP' | 'EP' => (l.choice !== '' ? l.choice : (derivedBasis(basis, l.kind, hasYield(l.stock_item_id)) ?? 'AP'));
  // The select shows '' (Default: X) for a stored basis equal to the derived one.
  const shownChoice = (l: LineState): Choice => {
    if (l.picked) return l.choice;
    const derived = derivedBasis(basis, l.kind, hasYield(l.stock_item_id));
    return derived !== null && derived === l.choice ? '' : l.choice;
  };

  // A prepared line's batch cost is the cloud's (never a rounded figure summed again): liveLineCost leaves it unknown
  // until Save draft, and its row says so.
  const liveOf = (l: LineState): LiveCost => liveLineCost(inventory.get(l.stock_item_id), { qty: l.qty, unit_name: l.unit_name, basis: lineBasis(l) });
  const lineCost = (l: LineState): string => {
    if (!dirty && l.saved !== null) return lineCostText(l.saved.line_cost);
    const live = liveOf(l);
    if (live.known) return lineCostText(livePlateCost([live], 0, false));
    return l.kind === 'prepared' ? t('recipe.cost_on_save') : t('recipes.cost_none');
  };
  const branchQuery = costBranch === null ? {} : { branch_id: costBranch };
  const miscBp = parseMiscPercent(form.misc) ?? 0;
  // AD-25: an empty non-option recipe is partial with no cost (as the cloud's CostWire); an empty option costs 0 (M-6).
  const plate: CostWire | null = dirty
    ? recipe.owner_type === 'modifier_option' || form.lines.length > 0
      ? livePlateCost(form.lines.map(liveOf), miscBp, top)
      : livePlateCost([], miscBp, top, false)
    : (shown?.cost ?? null);
  // §7 risk (1): the unknown items always show — the cloud's unknown_items when clean (named from the lines, else the
  // stock list), the lines whose live cost is unknown while editing.
  const stockName = (id: string) => shown?.lines.find((l) => l.stock_item_id === id)?.stock_item_name ?? stock.find((s) => s.stock_item_id === id)?.name;
  const missing: string[] = dirty
    ? form.lines.filter((l) => l.kind !== 'prepared' && !liveOf(l).known).map((l) => l.name) // prepared: "shown after Save draft" on its row
    : (shown?.cost.unknown_items ?? []).map((id) => stockName(id) ?? t('recipes.missing_unnamed'));

  function validate(): boolean {
    const found: Record<string, string> = {};
    form.lines.forEach((l, i) => {
      if (parseQty(l.qty) === null) found[`lines.${i}.qty`] = t('recipe.qty_invalid');
    });
    if (parseMiscPercent(form.misc) === null) found['misc_allowance_bp'] = t('recipe.misc_invalid');
    if (basis === 'per_measure' && !/^[0-9]{1,7}$/.test(form.baseQty.trim())) found['base_qty'] = t('recipe.base_qty_invalid');
    if (basis === 'per_batch' && form.batchYield.trim() !== '' && !/^[0-9]{1,10}$/.test(form.batchYield.trim())) found['batch_yield_qty'] = t('recipe.batch_yield_invalid');
    setFieldErrors(found);
    return Object.keys(found).length === 0;
  }

  function body(): SaveDraftBody {
    const out: SaveDraftBody = {
      expected_version: data?.draft?.version ?? null,
      misc_allowance_bp: parseMiscPercent(form.misc) ?? 500,
      lines: form.lines.map((l) => {
        const derived = derivedBasis(basis, l.kind, hasYield(l.stock_item_id));
        const send = l.choice !== '' && (l.picked || derived === null || derived !== l.choice);
        return { stock_item_id: l.stock_item_id, unit_name: l.unit_name, qty: l.qty.trim(), ...(send ? { qty_basis: l.choice as 'AP' | 'EP' } : {}) };
      }),
    };
    if (basis === 'per_measure') out.base_qty = Number(form.baseQty.trim());
    if (basis === 'per_batch' && form.batchYield.trim() !== '') out.batch_yield_qty = Number(form.batchYield.trim());
    return out;
  }

  function showError(error: CloudError) {
    const code = apiCode(error);
    if (code === 'CONFIG_STALE') {
      setStale(true);
      return;
    }
    if (code === 'RECIPE_NOT_FOUND') {
      setGone(true);
      return;
    }
    const restore = newDraftReason(error);
    if (restore !== null) {
      setNewDraft(restore);
      return;
    }
    if (error.kind === 'api' && code === 'CONFIG_REFERENCE_INVALID') {
      const field = error.details['field'];
      const text = reasonText(error.details['reason']);
      if (typeof field === 'string' && (/^lines\.\d+\./.test(field) || ['base_qty', 'batch_yield_qty', 'misc_allowance_bp'].includes(field))) {
        setFieldErrors({ [/^lines\.\d+\./.test(field) ? field.replace(/^(lines\.\d+)\..*$/, '$1.row') : field]: text });
      } else setBanner({ tone: 'danger', text });
      return;
    }
    const issues = issueMessages(error);
    const mapped = Object.fromEntries(Object.entries(issues).map(([k, v]) => [/^lines\.\d+\./.test(k) ? k.replace(/^(lines\.\d+)\..*$/, '$1.row') : k, v]));
    if (Object.keys(mapped).length > 0) {
      setFieldErrors(mapped);
      return;
    }
    setBanner({ tone: 'danger', text: errorText(error) ?? '' });
  }

  function start() {
    setBanner(null);
    setFieldErrors({});
    setNewDraft(null);
  }

  // Save draft; returns the saved draft's version for a publish, null when refused.
  async function saveDraft(): Promise<string | null> {
    if (!validate()) return null;
    const result = await api.saveRecipeDraft(recipeId, body(), branchQuery);
    if (!result.ok) {
      showError(result.error);
      return null;
    }
    setDirty(false);
    dirtyRef.current = false;
    return result.data.draft.version;
  }

  async function onSave() {
    start();
    setBusy(true);
    const saved = await saveDraft();
    setBusy(false);
    if (saved !== null) {
      await load();
      setBanner({ tone: 'ok', text: t('recipe.draft_saved') });
    }
  }

  async function onPublish() {
    start();
    setBusy(true);
    const expected = dirty || data?.draft == null ? await saveDraft() : data.draft.version;
    if (expected === null) {
      setBusy(false);
      return;
    }
    const result = await api.publishRecipe(recipeId, { expected_version: expected }, branchQuery);
    setBusy(false);
    if (!result.ok) {
      showError(result.error);
      return;
    }
    await load();
    setBanner({ tone: 'ok', text: t('recipe.published') });
  }

  async function onArchive(archived: boolean) {
    if (recipe.version === null) return;
    start();
    setBusy(true);
    const result = await api.patchRecipe(recipeId, { expected_version: recipe.version, archived });
    setBusy(false);
    if (!result.ok) {
      showError(result.error);
      return;
    }
    await load();
  }

  async function addLine(item: StockItem) {
    setSearch('');
    edit((prev) => ({
      ...prev,
      lines: [...prev.lines, { key: item.stock_item_id, stock_item_id: item.stock_item_id, name: item.name, kind: item.kind, qty: '', unit_name: item.stock_unit, choice: '', picked: true, saved: null }],
    }));
    const read = await readInventory([item.stock_item_id], inventory);
    setInventory(read);
  }

  const needle = search.trim().toLowerCase();
  const found =
    needle === ''
      ? []
      : stock
          .filter(
            (s) =>
              s.archived_at === null &&
              s.name.toLowerCase().includes(needle) &&
              !form.lines.some((l) => l.stock_item_id === s.stock_item_id) &&
              !(recipe.owner_type === 'stock_item' && recipe.owner_id === s.stock_item_id),
          )
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(0, MAX_SEARCH);

  const fieldError = (key: string) => fieldErrors[key] !== undefined && <span className="pos-field__error">{fieldErrors[key]}</span>;
  const ownerStockUnit: StockUnit = shown?.batch_stock_unit ?? (stock.find((s) => s.stock_item_id === recipe.owner_id)?.stock_unit ?? 'piece');

  const basisFields = (
    <section className="pos-section" data-section="basis">
      <div className="pos-section__head">
        <h2>{t('recipe.basis_title')}</h2>
      </div>
      <div className="pos-row">
        {basis === 'per_unit' && <p className="pos-note" data-basis="">{t(recipe.owner_type === 'modifier_option' ? 'recipe.per_option' : 'recipe.per_piece')}</p>}
        {basis === 'per_measure' && (
          <label className={`pos-field${fieldErrors['base_qty'] !== undefined ? ' pos-field--error' : ''}`}>
            <span className="pos-field__label">{fill(t('recipe.base_qty'), { unit: t(`stock_unit.${shown?.measure_unit ?? 'g'}`) })}</span>
            <input className="pos-input" name="base_qty" inputMode="numeric" value={form.baseQty} disabled={!data.can_edit_tenant} onChange={(e) => edit((p) => ({ ...p, baseQty: e.target.value }))} />
            <span className="pos-field__help" data-basis="">
              {measureText(shown?.measure_unit ?? null, /^[0-9]+$/.test(form.baseQty.trim()) ? Number(form.baseQty.trim()) : null)}
            </span>
            {fieldError('base_qty')}
          </label>
        )}
        {basis === 'per_batch' && (
          <label className={`pos-field${fieldErrors['batch_yield_qty'] !== undefined ? ' pos-field--error' : ''}`}>
            <span className="pos-field__label">{t('recipe.batch_yield')}</span>
            <input className="pos-input" name="batch_yield_qty" inputMode="numeric" value={form.batchYield} disabled={!data.can_edit_tenant} onChange={(e) => edit((p) => ({ ...p, batchYield: e.target.value }))} />
            {form.batchYield.trim() !== '' && (
              <span className="pos-field__help" data-makes="">
                {makesText(form.batchYield.trim(), ownerStockUnit)}
              </span>
            )}
            {fieldError('batch_yield_qty')}
          </label>
        )}
        <label className={`pos-field${fieldErrors['misc_allowance_bp'] !== undefined ? ' pos-field--error' : ''}`}>
          <span className="pos-field__label">{t('recipe.misc')}</span>
          <input className="pos-input" name="misc_pct" inputMode="decimal" value={form.misc} disabled={!data.can_edit_tenant} onChange={(e) => edit((p) => ({ ...p, misc: e.target.value }))} />
          <span className="pos-field__help">{t(top ? 'recipe.misc_help' : 'recipe.misc_help_batch')}</span>
          {fieldError('misc_allowance_bp')}
        </label>
      </div>
    </section>
  );

  // §7 risk (3): a line's warnings in its row. Clean: the cloud's B6 warnings by line_no − 1 (publish.ts's index).
  // Editing: live hints from the line's 08a read — "Default: AP — no yield", EP with no yield, no menu cost, EP in a batch.
  function lineWarnings(l: LineState, i: number): string[] {
    if (!dirty) {
      return (shown?.warnings ?? []).filter((w) => w.line_no !== undefined && w.line_no - 1 === i).map((w) => fill(t(`recipe.warn.${w.code}`), { line: l.name }));
    }
    const inv = inventory.get(l.stock_item_id);
    if (inv === undefined) return [];
    const out: string[] = [];
    const used = lineBasis(l);
    if (basis === 'per_batch' && used === 'EP') out.push(fill(t('recipe.warn.ep_in_batch'), { line: l.name }));
    if (l.kind === 'ingredient' && inv.active_yield === null && basis !== 'per_batch') {
      out.push(used === 'EP' ? fill(t('recipe.warn.ep_no_yield'), { line: l.name }) : t('recipe.hint_no_yield'));
    }
    if (l.kind !== 'prepared' && inv.menu_cost === null) out.push(fill(t('recipe.warn.no_menu_cost'), { line: l.name }));
    return out;
  }

  const lineRows = form.lines.map((l, i) => {
    const inv = inventory.get(l.stock_item_id);
    const units = inv === undefined ? [l.unit_name] : unitChoices(inv);
    if (!units.includes(l.unit_name)) units.push(l.unit_name);
    const derived = derivedBasis(basis, l.kind, hasYield(l.stock_item_id));
    const rowError = fieldErrors[`lines.${i}.row`] ?? fieldErrors[`lines.${i}.qty`];
    const rowWarnings = lineWarnings(l, i);
    return (
      <li key={l.key} className="pos-list__row" data-line={l.stock_item_id}>
        <div className="pos-list__name">
          <strong>{l.name}</strong>
          <span>{t(`stock_inv.kind_${l.kind}` as MessageKey)}</span>
          {rowError !== undefined && <span className="pos-field__error">{rowError}</span>}
          {rowWarnings.map((text) => (
            <span key={text} data-line-warning="">
              <Chip tone="warn">{text}</Chip>
            </span>
          ))}
        </div>
        <input
          className="pos-input num"
          name="qty"
          inputMode="decimal"
          aria-label={fill(t('recipe.qty_named'), { name: l.name })}
          value={l.qty}
          disabled={!data.can_edit_tenant}
          onChange={(e) => editLine(i, { qty: e.target.value })}
        />
        <select className="pos-select" name="unit" aria-label={fill(t('recipe.unit_named'), { name: l.name })} value={l.unit_name} disabled={!data.can_edit_tenant} onChange={(e) => editLine(i, { unit_name: e.target.value })}>
          {units.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
        <select
          className="pos-select"
          name="qty_basis"
          aria-label={fill(t('recipe.basis_named'), { name: l.name })}
          value={shownChoice(l)}
          disabled={!data.can_edit_tenant}
          onChange={(e) => editLine(i, { choice: e.target.value as Choice })}
        >
          <option value="">{derived === null ? t('recipe.basis_default_unknown') : fill(t('recipe.basis_default'), { basis: derived })}</option>
          <option value="AP">{t('recipe.basis_ap')}</option>
          <option value="EP">{t('recipe.basis_ep')}</option>
        </select>
        <span className="num" data-line-cost="">
          {lineCost(l)}
        </span>
        {data.can_edit_tenant && (
          <button
            type="button"
            className="pos-btn pos-btn--icon"
            aria-label={fill(t('recipe.remove_line'), { name: l.name })}
            onClick={() => edit((p) => ({ ...p, lines: p.lines.filter((_, j) => j !== i) }))}
          >
            <Icon name="trash" />
          </button>
        )}
      </li>
    );
  });

  // Recipe-level warnings (no line, e.g. main_line_off) sit under the cost; line warnings sit in their row.
  const warnings = dirty ? [] : (shown?.warnings ?? []).filter((w) => w.line_no === undefined);
  const lineName = (no: number | undefined) => shown?.lines.find((l) => l.line_no === no)?.stock_item_name ?? '';
  const history = data.history;

  const actions = data.can_edit_tenant && (
    <>
      <BusyButton busy={busy} disabled={!canWrite} onClick={() => void onSave()}>
        {t('recipe.save_draft')}
      </BusyButton>
      <button type="button" className="pos-btn pos-btn--primary" disabled={!canWrite || (!dirty && data.draft === null)} onClick={() => void onPublish()}>
        {t('recipe.publish')}
      </button>
      {recipe.archived ? (
        <button type="button" className="pos-btn" disabled={!canWrite} onClick={() => void onArchive(false)}>
          {t('recipe.restore')}
        </button>
      ) : (
        <button type="button" className="pos-btn" disabled={!canWrite} onClick={() => void onArchive(true)}>
          {t('recipe.archive')}
        </button>
      )}
    </>
  );

  return (
    <Page api={api} title={recipe.owner_name} start={back} end={actions}>
      <div className="pos-stack pos-c01form">
        <p className="pos-note" data-owner-header="">
          <strong>{recipe.owner_name}</strong> · {t(`recipe.owner_${recipe.owner_type}`)}
          {data.published !== null && ` · ${fill(t('recipes.published_v'), { n: String(data.published.version_no) })}`}
          {data.draft !== null && ` · ${t('recipes.draft')}`}
        </p>
        {stale && <StaleBanner onReload={() => {
          setDirty(false);
          dirtyRef.current = false;
          void load();
        }} />}
        {banner !== null && <Banner tone={banner.tone} text={banner.text} />}
        {recipe.archived && <Banner tone="info" text={t('recipe.archived_note')} />}
        {recipe.owner_archived && <Banner tone="info" text={t('recipe.owner_archived_note')} />}
        {newDraft !== null && (
          <div className="pos-banner pos-banner--warn" role="status" data-new-draft="">
            <Icon name="alert" />
            <p>
              {fill(t('recipes.restore_refused'), { reason: restoreReasonText(newDraft) })}
              <small>{t('recipe.new_version_help')}</small>
            </p>
            <div className="pos-banner__action pos-row">
              <button
                type="button"
                className="pos-btn pos-btn--primary"
                onClick={() => {
                  setNewDraft(null);
                  setDirty(true);
                }}
              >
                {t('recipes.new_version')}
              </button>
            </div>
          </div>
        )}
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
        {basisFields}
        <section className="pos-section" data-section="lines">
          <div className="pos-section__head">
            <h2>{t('recipe.lines_title')}</h2>
            <p>{t('recipe.lines_help')}</p>
          </div>
          {form.lines.length === 0 ? (
            <p className="pos-note">{t('recipe.no_lines')}</p>
          ) : (
            <ul className="pos-list pos-list--c5">
              <li className="pos-list__head">
                <span>{t('recipe.col_item')}</span>
                <span>{t('recipe.col_qty')}</span>
                <span>{t('recipe.col_unit')}</span>
                <span>{t('recipe.col_basis')}</span>
                <span>{t('recipe.col_line_cost')}</span>
                <span />
              </li>
              {lineRows}
            </ul>
          )}
          {data.can_edit_tenant && (
            <div className="pos-stack">
              <label className="pos-field">
                <span className="pos-field__label">{t('recipe.add_line')}</span>
                <input className="pos-input" name="line_search" placeholder={t('recipe.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
              </label>
              {found.length > 0 && (
                <div className="pos-chips">
                  {found.map((s) => (
                    <button key={s.stock_item_id} type="button" className="pos-btn" data-add-stock={s.stock_item_id} onClick={() => void addLine(s)}>
                      <Icon name="plus" />
                      {`${s.name} · ${t(`stock_inv.kind_${s.kind}`)}`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
        <section className="pos-section" data-section="cost">
          <div className="pos-section__head">
            <h2>{t(top ? 'recipe.plate_cost' : 'recipe.batch_cost')}</h2>
            <p>{t('recipe.cost_help')}</p>
          </div>
          <p className="num" data-plate-cost="">
            {plate === null ? t('recipes.cost_none') : costText(plate)}
          </p>
          {missing.length > 0 && (
            <p className="pos-note" data-missing-cost="">
              {fill(t('recipes.missing_cost'), { names: missing.join(', ') })}
            </p>
          )}
          {warnings.length > 0 && (
            <ul className="pos-banner__list" aria-label={t('recipe.warnings')}>
              {warnings.map((w, i) => (
                <li key={`${w.code}-${i}`} data-warning="">
                  <Chip tone="warn">{fill(t(`recipe.warn.${w.code}`), { line: lineName(w.line_no) })}</Chip>
                </li>
              ))}
            </ul>
          )}
        </section>
        {history.length > 0 && (
          <section className="pos-section" data-section="history">
            <div className="pos-section__head">
              <h2>{t('recipe.history')}</h2>
            </div>
            <ul className="pos-list" data-history="">
              {history.map((h) => (
                <li key={h.recipe_version_id} className="pos-list__row">
                  <span>{fill(t('recipe.history_row'), { n: String(h.version_no), status: t(`recipe.status_${h.status}`) })}</span>
                  <span className="pos-list__muted">
                    {h.published_at !== null && fill(t('stock_inv.by_when'), { who: h.published_by_name ?? '', when: when(h.published_at) })}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Page>
  );
}
