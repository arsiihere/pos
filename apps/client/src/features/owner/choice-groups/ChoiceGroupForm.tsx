import type { PatchModifierGroupRequest } from '@pos/events';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CloudAdmin, CloudError, MenuItem, ModifierGroup, ModifierLink } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { navigate } from '../../../app/router';
import { ActionBar } from '../../../components/ActionBar';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { ErrorSummary, type FixEntry } from '../../../components/ErrorSummary';
import { Gone } from '../../../components/Gone';
import { Icon } from '../../../components/Icon';
import { MoreMenu } from '../../../components/MoreMenu';
import { RemovedRows } from '../../../components/RemovedRows';
import { Skeleton } from '../../../components/Skeleton';
import { StaleBanner } from '../../../components/StaleBanner';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { useBranchName } from '../branch';
import { apiCode, BackLink, referenceText } from '../c01';
import { useCloudDown } from '../cloud';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import type { WholeMenu } from '../menu-pages';
import { formatRupees, parseRupees } from '../money';
import { Page } from '../Shell';
import { AppliesToDialog } from './AppliesToDialog';
import { ChoiceBranchRow } from './ChoiceBranchRow';
import { canBeKitchenItem, findChoiceGroup, targetName } from './choice';
import { MenuRetry, useMenuPages } from './useMenuPages';

// 01c-S03 (§8 "Views", §6.10–§6.12; V8): name, "Customers pick" (at least / at most), the options table
// (Option · Price · Goes to kitchen as · Up to · Default · remove), "Removed" options with Restore (01c-B06,
// the same option_id comes back), "Applies to" chips edited in 01c-D02, and the "At each branch" rows (01c-S10,
// §6.12a, each saved on its own with its own version). A new group is a POST with the form's Idempotency-Key
// and no option ids; an edit PATCHes `expected_version` + only the changed fields, `options` and `links` whole.
// 422 field paths map to the row as sent (options.N…); 409 CONFIG_STALE → 01c-B03 with the draft kept;
// 404 → the form is replaced (Q17). can_edit_tenant false → read-only; branch rows stay editable (§8).
const MAX_PRICE = 1_000_000_000;

interface Loaded {
  canEditTenant: boolean;
  group: ModifierGroup | null;
}

export function ChoiceGroupForm({ api, groupId }: { api: CloudAdmin; groupId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const { menu, done: menuDone, error: menuError, retry: retryMenu } = useMenuPages(api);

  const load = useCallback(async () => {
    const found = await findChoiceGroup(api, groupId);
    if (!found.ok) {
      setLoadError(errorText(found.error));
      return;
    }
    setLoaded(found.data);
    setLoadError(null);
    setGeneration((g) => g + 1);
  }, [api, groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Every menu page (useMenuPages), for the kitchen-item picker, the "Applies to" names and the 01c-B04 checks (N9).
  const back = <BackLink href="#/choice-groups" list={t('choice_groups.title')} label={t('choice_group.back_label')} />;

  if (loaded === null || menu === null) {
    return (
      <Page api={api} title={t('choice_groups.title')} start={back}>
        {loadError !== null ? (
          <Banner tone="danger" text={loadError} />
        ) : menuError !== null ? (
          <MenuRetry error={menuError} onRetry={retryMenu} />
        ) : (
          <Skeleton lines={6} />
        )}
      </Page>
    );
  }
  if (groupId !== 'new' && loaded.group === null) return <ChoiceGroupGone api={api} back={back} />;
  return (
    <Editor
      key={generation}
      api={api}
      canEditTenant={loaded.canEditTenant}
      group={groupId === 'new' ? null : loaded.group}
      menu={menu}
      menuDone={menuDone}
      menuError={menuError}
      onRetryMenu={retryMenu}
      back={back}
      onReload={() => void load()}
    />
  );
}

function ChoiceGroupGone({ api, back }: { api: CloudAdmin; back: ReactNode }) {
  return (
    <Page api={api} title={t('choice_group.title')} start={back}>
      <Gone
        title={t('choice_group.gone_title')}
        body={t('c01.gone_body')}
        back={fill(t('c01.back_to'), { list: t('choice_groups.title') })}
        onBack={() => navigate('/choice-groups')}
      />
    </Page>
  );
}

// One option row of the draft; `option_id` only on rows that exist (a new row carries none, §6.11, §8 "Ids").
interface Row {
  key: string;
  option_id?: string;
  name: string;
  price: string;
  linked: string;
  upTo: string;
  isDefault: boolean;
}

interface Errors {
  name?: string;
  pick?: string;
  options?: string;
  links?: string;
  rows: Record<number, string>;
}
const NO_ERRORS: Errors = { rows: {} };
const PICK_ID = 'cg-min';
const rowId = (i: number) => `cg-opt-${i}`;

let rowSeq = 0;
const newKey = () => `new-${++rowSeq}`;

function storedRows(group: ModifierGroup | null): Row[] {
  if (group === null)
    return [
      {
        key: newKey(),
        name: '',
        price: '',
        linked: '',
        upTo: '1',
        isDefault: false,
      },
    ];
  return [...group.options]
    .sort((a, b) => a.sort_order - b.sort_order || a.option_id.localeCompare(b.option_id))
    .map((o) => ({
      key: o.option_id,
      option_id: o.option_id,
      name: o.name,
      price: o.price_minor === null ? '' : formatRupees(o.price_minor),
      linked: o.linked_item_id ?? '',
      upTo: String(o.max_quantity),
      isDefault: o.is_default,
    }));
}

const sameLinks = (a: readonly ModifierLink[], b: readonly ModifierLink[]) => {
  const keyOf = (l: ModifierLink) => `${l.target_kind}|${l.target_id}|${l.mode}`;
  const set = new Set(a.map(keyOf));
  return a.length === b.length && b.every((l) => set.has(keyOf(l)));
};

function Editor({
  api,
  canEditTenant,
  group,
  menu,
  menuDone,
  menuError,
  onRetryMenu,
  back,
  onReload,
}: {
  api: CloudAdmin;
  canEditTenant: boolean;
  group: ModifierGroup | null;
  menu: WholeMenu;
  menuDone: boolean;
  menuError: string | null;
  onRetryMenu: () => void;
  back: ReactNode;
  onReload: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [min, setMin] = useState(String(group?.min_choices ?? 0));
  const [max, setMax] = useState(String(group?.max_choices ?? 1));
  const [rows, setRows] = useState<Row[]>(() => storedRows(group));
  const [removed, setRemoved] = useState<Row[]>([]);
  const [links, setLinks] = useState<ModifierLink[]>(group?.links ?? []);
  const [applying, setApplying] = useState(false);
  // Phone (ChoiceGroupPhone): one option edited at a time in a sheet; a new one is added on Done.
  const [editing, setEditing] = useState<{
    index: number;
    row: Row;
    isNew: boolean;
  } | null>(null);
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  const [banner, setBanner] = useState<{
    tone: 'danger' | 'warn';
    text: string;
  } | null>(null);
  const [stale, setStale] = useState(false);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowDirty, setRowDirty] = useState<ReadonlySet<string>>(new Set());
  const { key, renew } = useIdempotencyKey();
  const down = useCloudDown(api);
  const leave = useLeave();
  const phone = usePhone();
  const branchName = useBranchName();

  const archived = group !== null && group.archived_at !== null;
  const readOnly = !canEditTenant || archived;
  const title = group === null ? t('choice_group.new_title') : group.name;
  const items = useMemo(() => new Map(menu.items.map((item) => [item.item_id, item])), [menu]);
  const kitchenItems = menu.items.filter(canBeKitchenItem).sort((a, b) => a.name.localeCompare(b.name));

  // The options as they would be sent; `null` price when empty (a kitchen option then uses the item's price).
  const sent = rows.map((r, i) => {
    const price = r.price.trim() === '' ? null : parseRupees(r.price);
    return {
      ...(r.option_id === undefined ? {} : { option_id: r.option_id }),
      name: r.name.trim(),
      price_minor: price === null ? null : price.ok ? price.value : NaN,
      max_quantity: Number(r.upTo.trim()),
      is_default: r.isDefault,
      linked_item_id: r.linked === '' ? null : r.linked,
      sort_order: i,
    };
  });
  const stored = storedRows(group);
  const optionsChanged =
    group === null ||
    sent.length !== stored.length ||
    sent.some((o, i) => {
      const s = group.options.find((x) => x.option_id === stored[i]?.option_id);
      return (
        s === undefined ||
        o.option_id !== s.option_id ||
        o.name !== s.name ||
        o.price_minor !== s.price_minor ||
        o.max_quantity !== s.max_quantity ||
        o.is_default !== s.is_default ||
        o.linked_item_id !== s.linked_item_id
      );
    });

  const patch: Omit<PatchModifierGroupRequest, 'expected_version'> = {};
  if (group !== null) {
    if (name.trim() !== group.name) patch.name = name.trim();
    if (Number(min) !== group.min_choices) patch.min_choices = Number(min);
    if (Number(max) !== group.max_choices) patch.max_choices = Number(max);
    if (optionsChanged) patch.options = sent;
    if (!sameLinks(links, group.links)) patch.links = links;
  }
  const labels = {
    name: t('choice_group.name'),
    pick: t('choice_group.pick'),
    options: t('choice_group.options'),
    links: t('choice_group.applies'),
  };
  const changed =
    group === null
      ? name.trim() !== '' || rows.some((r) => r.name.trim() !== '')
        ? [labels.name]
        : []
      : [
          ...('name' in patch ? [labels.name] : []),
          ...('min_choices' in patch || 'max_choices' in patch ? [labels.pick] : []),
          ...('options' in patch ? [labels.options] : []),
          ...('links' in patch ? [labels.links] : []),
        ];
  const dirtyFields = [...changed, ...[...rowDirty].map(branchName)];
  useDirtyForm(dirtyFields.length === 0 || gone ? null : { name: name.trim() || title, fields: dirtyFields });

  const onRowDirty = useCallback((branchId: string, dirty: boolean) => {
    setRowDirty((prev) => {
      if (prev.has(branchId) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(branchId);
      else next.delete(branchId);
      return next;
    });
  }, []);

  function setRow(i: number, change: Partial<Row>) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...change } : r)));
    setErrors((prev) => {
      if (prev.rows[i] === undefined) return prev;
      const next = { ...prev.rows };
      delete next[i];
      return { ...prev, rows: next };
    });
  }
  function removeRow(i: number) {
    const row = rows[i];
    if (row === undefined) return;
    if (row.option_id !== undefined) setRemoved((prev) => [...prev, row]);
    setRows((prev) => prev.filter((_, j) => j !== i));
    setErrors((prev) => ({ ...prev, rows: {} }));
  }
  // 01c-B06: a row removed in this draft comes back as it was; a stored archived option comes back by its id
  // with its name (the wire carries only { option_id, name }), and the owner sets its price again.
  function restore(optionId: string) {
    const draft = removed.find((r) => r.option_id === optionId);
    if (draft !== undefined) {
      setRemoved((prev) => prev.filter((r) => r.option_id !== optionId));
      setRows((prev) => [...prev, draft]);
      return;
    }
    const archivedOption = group?.archived_options.find((o) => o.option_id === optionId);
    if (archivedOption === undefined) return;
    setRows((prev) => [
      ...prev,
      {
        key: optionId,
        option_id: optionId,
        name: archivedOption.name,
        price: '',
        linked: '',
        upTo: '1',
        isDefault: false,
      },
    ]);
  }
  const inDraft = new Set(rows.flatMap((r) => (r.option_id === undefined ? [] : [r.option_id])));
  const removedRows = [
    ...removed.map((r) => ({ id: r.option_id ?? r.key, label: r.name })),
    ...(group?.archived_options ?? [])
      .filter((o) => !inDraft.has(o.option_id) && !removed.some((r) => r.option_id === o.option_id))
      .map((o) => ({ id: o.option_id, label: o.name })),
  ];

  function validate(): boolean {
    const found: Errors = { rows: {} };
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > 40) found.name = t('choice_group.name_required');
    const lo = Number(min.trim());
    const hi = Number(max.trim());
    if (min.trim() === '' || max.trim() === '' || !Number.isInteger(lo) || !Number.isInteger(hi) || lo < 0 || lo > 50 || hi < 1 || hi > 50)
      found.pick = t('choice_group.pick_invalid');
    else if (lo > hi) found.pick = t('choice_group.pick_order');
    if (rows.length === 0) found.options = t('choice_group.options_required');
    const seen = new Map<string, number>();
    sent.forEach((o, i) => {
      const lower = o.name.toLowerCase();
      if (o.name === '' || o.name.length > 40) found.rows[i] = t('choice_group.option_name_required');
      else if (seen.has(lower)) found.rows[i] = t('errors.CONFIG_NAME_TAKEN');
      else if (Number.isNaN(o.price_minor) || (o.price_minor !== null && o.price_minor > MAX_PRICE))
        found.rows[i] = t('choice_group.price_invalid');
      else if (o.price_minor === null && o.linked_item_id === null) found.rows[i] = t('choice_group.price_required');
      else if (!Number.isInteger(o.max_quantity) || o.max_quantity < 1 || o.max_quantity > 20)
        found.rows[i] = t('choice_group.up_to_invalid');
      seen.set(lower, i);
    });
    setErrors(found);
    setBanner(null);
    return found.name === undefined && found.pick === undefined && found.options === undefined && Object.keys(found.rows).length === 0;
  }

  // 422 / 400 field paths map to the row as sent (§8 "Errors"): options.N… → row N; min/max → Customers pick.
  function fieldError(field: unknown, text: string): boolean {
    if (typeof field !== 'string') return false;
    const option = /^options\.(\d+)/.exec(field);
    if (option !== null) setErrors({ rows: { [Number(option[1])]: text } });
    else if (field === 'name') setErrors({ rows: {}, name: text });
    else if (field === 'min_choices' || field === 'max_choices') setErrors({ rows: {}, pick: text });
    else if (field === 'options') setErrors({ rows: {}, options: text });
    else if (field === 'links' || field.startsWith('links.')) setErrors({ rows: {}, links: text });
    else return false;
    return true;
  }

  function showError(error: CloudError) {
    const code = apiCode(error);
    if (code === 'CONFIG_STALE') {
      setStale(true);
      setBanner(null);
      return;
    }
    if (code === 'MODIFIER_GROUP_NOT_FOUND') {
      setGone(true);
      return;
    }
    if (error.kind === 'api' && code === 'CONFIG_NAME_TAKEN') {
      const taken = error.details['name'];
      const at = typeof taken === 'string' ? sent.findIndex((o) => o.name.toLowerCase() === taken.toLowerCase()) : -1;
      if (error.details['entity'] === 'modifier_option' && at >= 0) setErrors({ rows: { [at]: t('errors.CONFIG_NAME_TAKEN') } });
      else setErrors({ rows: {}, name: t('errors.CONFIG_NAME_TAKEN') });
      return;
    }
    if (error.kind === 'api' && code === 'CONFIG_REFERENCE_INVALID') {
      const text = referenceText(error.details);
      if (!fieldError(error.details['field'], text)) setBanner({ tone: 'danger', text });
      return;
    }
    if (error.kind === 'api' && code === 'VALIDATION_FAILED') {
      const issues = error.details['issues'];
      const path = Array.isArray(issues) ? (issues[0] as { path?: unknown } | undefined)?.path : undefined;
      if (fieldError(path, t('choice_group.check_field'))) return;
    }
    setBanner({
      tone: error.kind === 'network' ? 'warn' : 'danger',
      text: errorText(error) ?? '',
    });
  }

  async function save() {
    if (!validate()) return;
    if (group === null) {
      setBusy(true);
      const result = await api.createModifierGroup(
        {
          name: name.trim(),
          min_choices: Number(min),
          max_choices: Number(max),
          options: sent.map((o) => ({
            name: o.name,
            price_minor: o.price_minor,
            max_quantity: o.max_quantity,
            is_default: o.is_default,
            linked_item_id: o.linked_item_id,
            sort_order: o.sort_order,
          })),
          links,
        },
        key,
      );
      setBusy(false);
      if (result.ok) {
        renew();
        // The branch rows need the group's id, so a new group opens as an edit (S10 "At each branch").
        navigate(`/choice-groups/${encodeURIComponent(result.data.modifier_group.modifier_group_id)}`);
        return;
      }
      if (isKeyMismatch(result.error)) renew();
      showError(result.error);
      return;
    }
    const done = () => (rowDirty.size === 0 ? navigate('/choice-groups') : leave(() => navigate('/choice-groups')));
    if (Object.keys(patch).length === 0) {
      done();
      return;
    }
    setBusy(true);
    const result = await api.patchModifierGroup(group.modifier_group_id, {
      expected_version: group.version,
      ...patch,
    });
    setBusy(false);
    if (result.ok) {
      done();
      return;
    }
    showError(result.error);
  }

  async function setArchived(next: boolean) {
    if (group === null) return;
    setBanner(null);
    setBusy(true);
    const result = await api.patchModifierGroup(group.modifier_group_id, {
      expected_version: group.version,
      archived: next,
    });
    setBusy(false);
    if (result.ok) {
      if (next) navigate('/choice-groups');
      else onReload();
      return;
    }
    showError(result.error);
  }

  if (gone) return <ChoiceGroupGone api={api} back={back} />;

  const fixes: FixEntry[] = [
    ...(errors.name !== undefined ? [{ target: 'cg-name', label: labels.name }] : []),
    ...(errors.pick !== undefined ? [{ target: PICK_ID, label: labels.pick }] : []),
    ...(errors.options !== undefined ? [{ target: 'cg-options', label: labels.options }] : []),
    ...Object.keys(errors.rows).map((i) => ({
      target: rowId(Number(i)),
      label: fill(t('choice_group.option_n'), { n: String(Number(i) + 1) }),
    })),
    ...(errors.links !== undefined ? [{ target: 'cg-links', label: labels.links }] : []),
  ];
  const saveButton = !readOnly && (
    <BusyButton primary busy={busy} disabled={down || stale} onClick={() => void save()}>
      {group === null ? t('choice_group.create') : t('choice_group.save')}
    </BusyButton>
  );
  const more =
    group !== null && canEditTenant ? (
      <MoreMenu
        label={fill(t('common.more_for'), { name: group.name })}
        items={
          archived
            ? [
                {
                  label: t('choice_group.restore'),
                  icon: 'reload',
                  disabled: down || busy,
                  onSelect: () => void setArchived(false),
                },
              ]
            : [
                {
                  label: t('choice_group.archive'),
                  icon: 'archive',
                  danger: true,
                  disabled: down || busy,
                  onSelect: () => void setArchived(true),
                },
              ]
        }
      />
    ) : undefined;
  const firstKitchen = rows.findIndex((r) => r.linked !== '');
  // Phone card line: "Goes to kitchen as Naan · up to 6 · item price" / "A note only · up to 1 · Rs 0".
  const optionSummary = (row: Row) => {
    const linked = row.linked === '' ? undefined : items.get(row.linked);
    const parts = [
      row.linked === ''
        ? t('choice_group.sum_note')
        : fill(t('choice_group.sum_kitchen'), {
            item: itemLabel(linked, row.linked),
          }),
      fill(t('choice_group.sum_up_to'), { n: row.upTo.trim() }),
      row.price.trim() === ''
        ? row.linked === ''
          ? t('choice_group.sum_no_price')
          : t('choice_group.sum_item_price')
        : `${t('owner.menu.rupees')} ${row.price.trim()}`,
      ...(row.isDefault ? [t('choice_group.sum_default')] : []),
    ];
    return parts.join(' · ');
  };
  function doneEditing() {
    if (editing === null) return;
    const { index, row, isNew } = editing;
    if (isNew) setRows((prev) => [...prev, row]);
    else setRow(index, row);
    setEditing(null);
  }
  const itemLabel = (item: MenuItem | undefined, id: string) => item?.name ?? id;

  const minInput = (
    <input
      id={PICK_ID}
      className="pos-input pos-input--mono"
      name="min_choices"
      inputMode="numeric"
      aria-label={t('choice_group.at_least')}
      value={min}
      disabled={readOnly}
      onChange={(e) => setMin(e.target.value)}
    />
  );
  const maxInput = (
    <input
      className="pos-input pos-input--mono"
      name="max_choices"
      inputMode="numeric"
      aria-label={t('choice_group.at_most')}
      value={max}
      disabled={readOnly}
      onChange={(e) => setMax(e.target.value)}
    />
  );

  return (
    <Page
      api={api}
      title={title}
      start={back}
      end={
        <>
          {more}
          {!phone && !readOnly && (
            <button type="button" className="pos-btn" onClick={() => leave(() => navigate('/choice-groups'))}>
              {t('common.cancel')}
            </button>
          )}
          {!phone && saveButton}
        </>
      }
    >
      {stale && <StaleBanner onReload={onReload} />}
      <ErrorSummary entries={fixes} />
      {banner !== null && <Banner tone={banner.tone} text={banner.text} />}
      {archived && <Banner tone="info" text={t('choice_group.archived_note')} />}
      {menuError !== null && <MenuRetry error={menuError} onRetry={onRetryMenu} />}
      <div className="pos-stack pos-c01form pos-cgform">
        <section className="pos-section">
          <div className="pos-fold__head">
            <div className="pos-section__head">
              <h2>{t('choice_group.section')}</h2>
            </div>
          </div>
          <div className="pos-grid">
            <label className={`pos-field${errors.name !== undefined ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{labels.name}</span>
              <input
                id="cg-name"
                className="pos-input"
                name="name"
                maxLength={40}
                placeholder={t('choice_group.name_placeholder')}
                value={name}
                disabled={readOnly}
                onChange={(e) => setName(e.target.value)}
              />
              {errors.name !== undefined && <span className="pos-field__error">{errors.name}</span>}
            </label>
            <div className={`pos-field${errors.pick !== undefined ? ' pos-field--error' : ''}`} data-pick="">
              {!phone && <span className="pos-field__label">{labels.pick}</span>}
              {phone ? (
                <div className="pos-cgpick2">
                  <label className="pos-field">
                    <span className="pos-field__label">{t('choice_group.at_least_cap')}</span>
                    {minInput}
                  </label>
                  <label className="pos-field">
                    <span className="pos-field__label">{t('choice_group.at_most_cap')}</span>
                    {maxInput}
                  </label>
                </div>
              ) : (
                <div className="pos-pickrow">
                  <span className="pos-note">{t('choice_group.at_least')}</span>
                  {minInput}
                  <span className="pos-note">{t('choice_group.at_most')}</span>
                  {maxInput}
                </div>
              )}
              {errors.pick !== undefined && (
                <span className="pos-field__error">
                  <Icon name="alert" />
                  {errors.pick}
                </span>
              )}
              {!phone && <span className="pos-field__help">{t('choice_group.at_least_help')}</span>}
            </div>
          </div>
        </section>

        <section className="pos-section" data-options="">
          <div className="pos-fold__head">
            <div className="pos-section__head">
              <h2>{labels.options}</h2>
            </div>
            {!readOnly && !phone && (
              <button
                type="button"
                className="pos-btn"
                disabled={rows.length >= 50}
                onClick={() =>
                  setRows((prev) => [
                    ...prev,
                    {
                      key: newKey(),
                      name: '',
                      price: '',
                      linked: '',
                      upTo: '1',
                      isDefault: false,
                    },
                  ])
                }
              >
                <Icon name="plus" />
                {t('choice_group.add_option')}
              </button>
            )}
          </div>
          {errors.options !== undefined && (
            <span className="pos-field__error" id="cg-options" tabIndex={-1}>
              <Icon name="alert" />
              {errors.options}
            </span>
          )}
          {phone ? (
            <div className="pos-cgcards">
              {rows.map((row, i) => {
                const error = errors.rows[i];
                const label = row.name.trim() === '' ? fill(t('choice_group.option_n'), { n: String(i + 1) }) : row.name.trim();
                return (
                  <div
                    key={row.key}
                    id={rowId(i)}
                    className={`pos-pcard pos-cgcard${error !== undefined ? ' is-error' : ''}`}
                    data-option-row={i}
                  >
                    <div className="pos-pcard__top">
                      <div>
                        <strong>{label}</strong>
                        <span className="sub">{optionSummary(row)}</span>
                      </div>
                      {!readOnly && (
                        <button
                          type="button"
                          className="pos-iconbtn"
                          aria-label={fill(t('choice_group.edit_named'), {
                            name: label,
                          })}
                          onClick={() => setEditing({ index: i, row, isNew: false })}
                        >
                          <Icon name="edit" />
                        </button>
                      )}
                    </div>
                    {error !== undefined && (
                      <span className="pos-field__error">
                        <Icon name="alert" />
                        {error}
                      </span>
                    )}
                  </div>
                );
              })}
              {!readOnly && (
                <button
                  type="button"
                  className="pos-btn pos-btn--block"
                  disabled={rows.length >= 50}
                  onClick={() =>
                    setEditing({
                      index: rows.length,
                      row: {
                        key: newKey(),
                        name: '',
                        price: '',
                        linked: '',
                        upTo: '1',
                        isDefault: false,
                      },
                      isNew: true,
                    })
                  }
                >
                  <Icon name="plus" />
                  {t('choice_group.add_option')}
                </button>
              )}
            </div>
          ) : (
            <div className="pos-opts">
              {
                <div className="pos-opts__head">
                  <span>{t('choice_group.col_option')}</span>
                  <span>{t('choice_group.col_price')}</span>
                  <span>{t('choice_group.col_kitchen')}</span>
                  <span>{t('choice_group.col_up_to')}</span>
                  <span>{t('choice_group.col_default')}</span>
                  <span />
                </div>
              }
              {rows.map((row, i) => {
                const error = errors.rows[i];
                const linkedItem = row.linked === '' ? undefined : items.get(row.linked);
                const label = row.name.trim() === '' ? fill(t('choice_group.option_n'), { n: String(i + 1) }) : row.name.trim();
                return (
                  <div key={row.key} id={rowId(i)} className={`pos-opt${error !== undefined ? ' is-error' : ''}`} data-option-row={i}>
                    <input
                      className="pos-input"
                      name={`options.${i}.name`}
                      maxLength={40}
                      aria-label={t('choice_group.col_option')}
                      value={row.name}
                      disabled={readOnly}
                      onChange={(e) => setRow(i, { name: e.target.value })}
                    />
                    <span className="pos-input-affix">
                      <span>{t('owner.menu.rupees')}</span>
                      <input
                        className="pos-input pos-input--mono"
                        name={`options.${i}.price`}
                        inputMode="decimal"
                        aria-label={t('choice_group.col_price')}
                        placeholder={row.linked !== '' ? t('choice_group.items_price') : ''}
                        value={row.price}
                        disabled={readOnly}
                        onChange={(e) => setRow(i, { price: e.target.value })}
                      />
                    </span>
                    <select
                      className="pos-select"
                      name={`options.${i}.linked_item_id`}
                      aria-label={t('choice_group.col_kitchen')}
                      value={row.linked}
                      disabled={readOnly}
                      onChange={(e) => setRow(i, { linked: e.target.value })}
                    >
                      <option value="">{t('choice_group.kitchen_none')}</option>
                      {row.linked !== '' && !kitchenItems.some((k) => k.item_id === row.linked) && (
                        <option value={row.linked}>{itemLabel(linkedItem, row.linked)}</option>
                      )}
                      {kitchenItems.map((k) => (
                        <option key={k.item_id} value={k.item_id}>
                          {k.name}
                        </option>
                      ))}
                    </select>
                    <span className="pos-input-affix">
                      <input
                        className="pos-input pos-input--mono"
                        name={`options.${i}.max_quantity`}
                        inputMode="numeric"
                        aria-label={t('choice_group.col_up_to')}
                        value={row.upTo}
                        disabled={readOnly}
                        onChange={(e) => setRow(i, { upTo: e.target.value })}
                      />
                    </span>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={row.isDefault}
                      className={`pos-tick${row.isDefault ? ' is-on' : ''}`}
                      disabled={readOnly}
                      aria-label={fill(t('choice_group.default_for'), {
                        name: label,
                      })}
                      onClick={() => setRow(i, { isDefault: !row.isDefault })}
                    >
                      <i />
                      {t('choice_group.col_default_word')}
                    </button>
                    {readOnly ? (
                      <span />
                    ) : (
                      <button
                        type="button"
                        className="pos-iconbtn"
                        aria-label={fill(t('choice_group.remove_named'), {
                          name: label,
                        })}
                        disabled={rows.length <= 1}
                        onClick={() => removeRow(i)}
                      >
                        <Icon name="trash" />
                      </button>
                    )}
                    {i === firstKitchen && linkedItem !== undefined && row.price.trim() === '' && (
                      <span className="pos-field__help">
                        {fill(t('choice_group.kitchen_help'), {
                          item: linkedItem.name,
                        })}
                      </span>
                    )}
                    {error !== undefined && (
                      <span className="pos-field__error">
                        <Icon name="alert" />
                        {error}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <RemovedRows rows={removedRows} onRestore={restore} disabled={readOnly} />
        </section>

        <section className="pos-section" data-applies="" id="cg-links">
          <div className="pos-fold__head">
            <div className="pos-section__head">
              <h2>{labels.links}</h2>
            </div>
            {!readOnly && !phone && (
              <button type="button" className="pos-btn" onClick={() => setApplying(true)}>
                <Icon name="edit" />
                {t('choice_group.applies_edit')}
              </button>
            )}
          </div>
          {links.length === 0 ? (
            <p className="pos-note">{t('choice_groups.applies_none')}</p>
          ) : (
            <div className="pos-targets">
              {links.map((link) => {
                const kind = t(`choice_group.target_${link.target_kind}` as 'choice_group.target_category');
                const text = `${kind}: ${targetName(menu, link) || '…'}`;
                return link.mode === 'attach' ? (
                  <span key={`${link.target_kind}-${link.target_id}`} className="pos-chip pos-chip--accent">
                    <Icon name="check" />
                    {text}
                  </span>
                ) : (
                  <span key={`${link.target_kind}-${link.target_id}`} className="pos-chip pos-chip--off">
                    <Icon name="x" />
                    <s>{fill(t('choice_group.not_here_chip'), { target: text })}</s>
                  </span>
                );
              })}
            </div>
          )}
          {errors.links !== undefined && (
            <span className="pos-field__error">
              <Icon name="alert" />
              {errors.links}
            </span>
          )}
          {phone ? (
            !readOnly && (
              <button type="button" className="pos-btn pos-btn--block" onClick={() => setApplying(true)}>
                <Icon name="edit" />
                {t('choice_group.applies_edit')}
              </button>
            )
          ) : (
            <p className="pos-note">{t('choice_group.rule')}</p>
          )}
        </section>

        {group !== null && (
          <section className="pos-section" data-branches="">
            <div className="pos-fold__head">
              <div className="pos-section__head">
                <h2>{t('c01.at_each_branch')}</h2>
                {!phone && <p>{t('choice_group.branches_help')}</p>}
              </div>
            </div>
            <div className="pos-branches">
              {group.branches.map((entry) => (
                <ChoiceBranchRow
                  key={entry.branch_id}
                  api={api}
                  group={group}
                  entry={entry}
                  items={items}
                  menuDone={menuDone}
                  down={down}
                  archived={archived}
                  onDirty={onRowDirty}
                />
              ))}
            </div>
          </section>
        )}
      </div>
      {phone && !readOnly && <ActionBar>{saveButton}</ActionBar>}
      {editing !== null && (
        <OptionSheet
          row={editing.row}
          title={
            editing.isNew
              ? t('choice_group.new_option')
              : editing.row.name.trim() ||
                fill(t('choice_group.option_n'), {
                  n: String(editing.index + 1),
                })
          }
          kitchenItems={kitchenItems}
          linkedLabel={(id) => itemLabel(items.get(id), id)}
          canRemove={!editing.isNew && rows.length > 1}
          onChange={(change) => setEditing((prev) => (prev === null ? prev : { ...prev, row: { ...prev.row, ...change } }))}
          onRemove={() => {
            removeRow(editing.index);
            setEditing(null);
          }}
          onDone={doneEditing}
          onCancel={() => setEditing(null)}
        />
      )}
      {applying && (
        <AppliesToDialog
          groupName={name.trim() || title}
          menu={menu}
          loading={!menuDone && menuError === null}
          error={menuError}
          onRetry={onRetryMenu}
          links={links}
          onClose={() => setApplying(false)}
          onDone={(next) => {
            setLinks(next);
            setErrors((prev) => ({ ...prev, links: undefined }));
            setApplying(false);
          }}
        />
      )}
    </Page>
  );
}

// ChoiceGroupPhone: the one option being edited, in a sheet (kit Dialog); Done writes it back to the draft.
function OptionSheet({
  row,
  title,
  kitchenItems,
  linkedLabel,
  canRemove,
  onChange,
  onRemove,
  onDone,
  onCancel,
}: {
  row: Row;
  title: string;
  kitchenItems: readonly MenuItem[];
  linkedLabel: (itemId: string) => string;
  canRemove: boolean;
  onChange: (change: Partial<Row>) => void;
  onRemove: () => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      footer={
        <>
          {canRemove && (
            <button type="button" className="pos-btn pos-btn--danger pos-cgsheet__remove" onClick={onRemove}>
              <Icon name="trash" />
              {t('choice_group.remove')}
            </button>
          )}
          <button type="button" className="pos-btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="pos-btn pos-btn--primary" onClick={onDone}>
            {t('applies.done')}
          </button>
        </>
      }
    >
      <div className="pos-stack pos-cgsheet" data-option-sheet="">
        <label className="pos-field">
          <span className="pos-field__label">{t('choice_group.col_option')}</span>
          <input
            className="pos-input"
            name="sheet.name"
            maxLength={40}
            value={row.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
        <label className="pos-field">
          <span className="pos-field__label">{t('choice_group.col_kitchen')}</span>
          <select
            className="pos-select"
            name="sheet.linked_item_id"
            value={row.linked}
            onChange={(e) => onChange({ linked: e.target.value })}
          >
            <option value="">{t('choice_group.kitchen_none')}</option>
            {row.linked !== '' && !kitchenItems.some((k) => k.item_id === row.linked) && (
              <option value={row.linked}>{linkedLabel(row.linked)}</option>
            )}
            {kitchenItems.map((k) => (
              <option key={k.item_id} value={k.item_id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <div className="pos-cgpick2">
          <label className="pos-field">
            <span className="pos-field__label">{t('choice_group.col_price')}</span>
            <span className="pos-input-affix">
              <span>{t('owner.menu.rupees')}</span>
              <input
                className="pos-input pos-input--mono"
                name="sheet.price"
                inputMode="decimal"
                placeholder={row.linked !== '' ? t('choice_group.items_price') : ''}
                value={row.price}
                onChange={(e) => onChange({ price: e.target.value })}
              />
            </span>
          </label>
          <label className="pos-field">
            <span className="pos-field__label">{t('choice_group.col_up_to')}</span>
            <input
              className="pos-input pos-input--mono"
              name="sheet.max_quantity"
              inputMode="numeric"
              value={row.upTo}
              onChange={(e) => onChange({ upTo: e.target.value })}
            />
          </label>
        </div>
        <button
          type="button"
          role="checkbox"
          aria-checked={row.isDefault}
          className={`pos-tick${row.isDefault ? ' is-on' : ''}`}
          onClick={() => onChange({ isDefault: !row.isDefault })}
        >
          <i />
          {t('choice_group.col_default_word')}
        </button>
      </div>
    </Dialog>
  );
}
