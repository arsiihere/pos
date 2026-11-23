import { useCallback, useEffect, useRef, useState } from 'react';
import type { CloudAdmin, RecipeList as RecipeListData, RecipeOwnerType, RecipeSummaryWire } from '../../../api/cloud-admin';
import { navigate } from '../../../app/router';
import { newUlid } from '../../../app/ulid';
import { Banner } from '../../../components/Banner';
import { Chip } from '../../../components/Chip';
import { Segmented } from '../../../components/Segmented';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { useBranchName } from '../branch';
import { apiCode, ListEmpty } from '../c01';
import { useCloudDown } from '../cloud';
import { errorText } from '../form';
import { Page } from '../Shell';
import { costText, coverageText, newDraftReason, reasonText, recipeHref, recipeInUseIds, restoreReasonText } from './recipes';

// 08 v1.1 Part B §8.1 (§6.1): coverage line, filter All / Missing / Partial (the §6.1 query), rows grouped Menu items
// · Options · Prepared, each with Plate cost (menu cost) from CostWire for the picked branch (B12; "Every branch" =
// none). A row without a recipe offers Create recipe (§6.3); an archived recipe offers Restore (§6.6), whose refusal
// with hint new_draft says "Make a new recipe version" (T-1).
type Filter = 'all' | 'missing' | 'partial';
const GROUPS: readonly RecipeOwnerType[] = ['menu_item', 'modifier_option', 'stock_item'];

export function RecipeList({
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
  const [data, setData] = useState<RecipeListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [costBranch, setCostBranch] = useState<string | null>(branchId !== null && branchIds.includes(branchId) ? branchId : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refused, setRefused] = useState<Record<string, string>>({});
  // §7 risk (1): unknown items are named from one stock-item read for the page.
  const [stockNames, setStockNames] = useState<ReadonlyMap<string, string>>(new Map());
  const branchName = useBranchName();
  const down = useCloudDown(api);

  useEffect(() => {
    let live = true;
    void api.listStockItems({}).then((result) => {
      if (live && result.ok && Array.isArray(result.data.stock_items)) setStockNames(new Map(result.data.stock_items.map((s) => [s.stock_item_id, s.name])));
    });
    return () => {
      live = false;
    };
  }, [api]);

  const latest = useRef(0);
  const load = useCallback(async () => {
    const request = ++latest.current;
    const result = await api.listRecipes({
      ...(costBranch === null ? {} : { branch_id: costBranch }),
      ...(filter === 'all' ? {} : { filter }),
    });
    if (request !== latest.current) return;
    if (result.ok) {
      setData(result.data);
      setError(null);
    } else setError(errorText(result.error));
  }, [api, costBranch, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const canEdit = data?.can_edit_tenant === true && !down;

  async function create(row: RecipeSummaryWire) {
    setBusy(row.owner_id);
    const result = await api.createRecipe({ owner_type: row.owner_type, owner_id: row.owner_id }, newUlid());
    setBusy(null);
    if (result.ok) {
      navigate(`/recipes/${encodeURIComponent(result.data.recipe.recipe_id ?? '')}`);
      return;
    }
    // §6.3: one recipe per owner — a stale list opens the one that exists.
    const existing = recipeInUseIds(result.error)?.[0];
    if (existing !== undefined) {
      navigate(`/recipes/${encodeURIComponent(existing)}`);
      return;
    }
    setError(apiCode(result.error) === 'CONFIG_REFERENCE_INVALID' && result.error.kind === 'api' ? reasonText(result.error.details['reason']) : errorText(result.error));
  }

  async function restore(row: RecipeSummaryWire) {
    if (row.recipe_id === null || row.version === null) return;
    setBusy(row.owner_id);
    const result = await api.patchRecipe(row.recipe_id, { expected_version: row.version, archived: false });
    setBusy(null);
    if (result.ok) {
      void load();
      return;
    }
    const reason = newDraftReason(result.error);
    if (reason !== null) setRefused((prev) => ({ ...prev, [row.owner_id]: reason }));
    // a stale row (another tab archived / restored / published): read the list again, as the editor's Reload
    else if (apiCode(result.error) === 'CONFIG_STALE') {
      await load();
      setError(t('recipes.stale_reloaded'));
    } else setError(errorText(result.error));
  }

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

  const status = (row: RecipeSummaryWire) => (
    <span className="pos-list__tags">
      {row.published !== null && <span className="pos-list__meta">{fill(t('recipes.published_v'), { n: String(row.published.version_no) })}</span>}
      {row.has_draft && <Chip tone="info">{t('recipes.draft')}</Chip>}
      {row.archived && (
        <Chip tone="warn" icon="archive">
          {t('recipes.archived')}
        </Chip>
      )}
      {row.owner_archived && <Chip icon="archive">{t('recipes.owner_archived')}</Chip>}
    </span>
  );

  const action = (row: RecipeSummaryWire) => {
    if (row.recipe_id === null) {
      return canEdit ? (
        <button type="button" className="pos-btn" disabled={busy !== null} onClick={() => void create(row)}>
          {t('recipes.create')}
        </button>
      ) : (
        <span />
      );
    }
    return (
      <span className="pos-rowact">
        {canEdit && row.archived && (
          <button type="button" className="pos-btn" disabled={busy !== null} onClick={() => void restore(row)}>
            {t('recipes.restore')}
          </button>
        )}
        <a className="pos-btn" href={recipeHref(row.recipe_id)} aria-label={fill(t('recipes.open_named'), { name: row.owner_name })}>
          {t('in_use.open')}
        </a>
      </span>
    );
  };

  let body;
  if (data === null) body = error !== null ? <Banner tone="danger" text={error} /> : <Skeleton lines={6} />;
  else
    body = (
      <>
        <p className="pos-note" data-coverage="">
          {coverageText(data.coverage)}
        </p>
        <div className="pos-row">
          <Segmented
            label={t('recipes.filter_label')}
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('recipes.filter_all') },
              { value: 'missing', label: t('recipes.filter_missing') },
              { value: 'partial', label: t('recipes.filter_partial') },
            ]}
          />
          {costFor}
        </div>
        <p className="pos-note">{t('recipes.help')}</p>
        {error !== null && <Banner tone="danger" text={error} />}
        {data.rows.length === 0 && <ListEmpty icon="search" title={t('recipes.empty')} />}
        {GROUPS.map((group) => {
          const rows = data.rows.filter((r) => r.owner_type === group);
          if (rows.length === 0) return null;
          return (
            <section key={group} className="pos-section" data-group={group}>
              <div className="pos-section__head">
                <h2>{t(`recipes.group_${group}`)}</h2>
              </div>
              <ul className="pos-list pos-list--c5">
                <li className="pos-list__head">
                  <span>{t('recipes.col_owner')}</span>
                  <span>{t('recipes.col_status')}</span>
                  <span>{t('recipes.col_cost')}</span>
                  <span />
                  <span />
                </li>
                {rows.map((row) => (
                  <li key={row.owner_id} className={`pos-list__row${row.archived || row.owner_archived ? ' is-archived' : ''}`} data-owner-id={row.owner_id}>
                    <div className="pos-list__name">
                      <strong>{row.owner_name}</strong>
                    </div>
                    {status(row)}
                    <span>
                      <span className={`num${row.plate_cost.status === 'costed' ? '' : ' pos-list__muted'}`} data-plate-cost="">
                        {costText(row.plate_cost)}
                      </span>
                      {row.plate_cost.unknown_items.length > 0 && (
                        <small className="pos-list__muted" data-missing-cost="">
                          {' '}
                          {fill(t('recipes.missing_cost'), {
                            names: row.plate_cost.unknown_items.map((id) => stockNames.get(id) ?? t('recipes.missing_unnamed')).join(', '),
                          })}
                        </small>
                      )}
                    </span>
                    {refused[row.owner_id] !== undefined && row.recipe_id !== null ? (
                      <span className="pos-field__error" data-new-draft="">
                        {fill(t('recipes.restore_refused'), { reason: restoreReasonText(refused[row.owner_id]) })}{' '}
                        <a href={recipeHref(row.recipe_id)}>{t('recipes.new_version')}</a>
                      </span>
                    ) : (
                      <span />
                    )}
                    {action(row)}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </>
    );

  return (
    <Page api={api} title={t('recipes.title')}>
      {body}
    </Page>
  );
}
