import { useEffect, useState } from 'react';
import type { CloudAdmin, MenuItem, ModifierGroup, ModifierGroupBranch } from '../../../api/cloud-admin';
import { BranchRow } from '../../../components/BranchRow';
import { Icon } from '../../../components/Icon';
import { Switch } from '../../../components/Switch';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { useBranchName } from '../branch';
import { apiCode, referenceText } from '../c01';
import { errorText } from '../form';
import { formatRupees, parseRupees, shownRupees } from '../money';
import { baseText, findChoiceGroup, nothingOffered, omittedAt } from './choice';

// 01c-S10 (§8 "Views", §6.12a, V19; Q15): one "At each branch" row of a choice group. Collapsed: the branch
// name and chips ("All 3 offered" / "1 switched off" / "Garlic naan Rs 70" / 01c-B04 / 01c-B05). Expanded:
// every active option with "Offered here" and "Price here" (empty = the base price). The row Save sends the
// WHOLE difference list at this branch (entries equal to the default are left out; [] resets everything) with
// this row's version, no Idempotency-Key. F1 (01c-B05): a required group with nothing offered warns, and the
// save is still allowed. 409 CONFIG_STALE → 01c-B03 on this row only.
const MAX_PRICE = 1_000_000_000;

interface Entry {
  option_id: string;
  is_offered: boolean;
  price_minor_override: number | null;
}

interface Draft {
  offered: boolean;
  price: string;
}

function draftOf(group: ModifierGroup, entry: ModifierGroupBranch): Record<string, Draft> {
  return Object.fromEntries(
    group.options.map((o) => {
      const row = entry.options.find((x) => x.option_id === o.option_id);
      const price = row?.price_minor_override ?? null;
      return [o.option_id, { offered: row?.is_offered ?? true, price: price === null ? '' : formatRupees(price) }];
    }),
  );
}

export function ChoiceBranchRow({
  api,
  group,
  entry,
  items,
  menuDone,
  down,
  onDirty,
}: {
  api: CloudAdmin;
  group: ModifierGroup;
  entry: ModifierGroupBranch;
  items: ReadonlyMap<string, MenuItem>;
  menuDone: boolean;
  down: boolean;
  onDirty: (branchId: string, dirty: boolean) => void;
}) {
  const branchName = useBranchName();
  const [stored, setStored] = useState(entry);
  const [draft, setDraft] = useState(() => draftOf(group, entry));
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [priceError, setPriceError] = useState<string | null>(null);
  const name = branchName(stored.branch_id);
  const options = [...group.options].sort((a, b) => a.sort_order - b.sort_order || a.option_id.localeCompare(b.option_id));

  // The difference list the draft stands for; a price that does not parse keeps the row dirty and is caught on Save.
  const diff = options.flatMap((o): Entry[] => {
    const d = draft[o.option_id] ?? { offered: true, price: '' };
    if (!d.offered) return [{ option_id: o.option_id, is_offered: false, price_minor_override: null }];
    if (d.price.trim() === '') return [];
    const parsed = parseRupees(d.price);
    return [{ option_id: o.option_id, is_offered: true, price_minor_override: parsed.ok ? parsed.value : NaN }];
  });
  const storedDiff = options.flatMap((o): Entry[] => {
    const row = stored.options.find((x) => x.option_id === o.option_id);
    return row === undefined || (row.is_offered && row.price_minor_override === null) ? [] : [row];
  });
  const dirty =
    diff.length !== storedDiff.length ||
    diff.some((d, i) => {
      const s = storedDiff[i];
      return s === undefined || s.option_id !== d.option_id || s.is_offered !== d.is_offered || s.price_minor_override !== d.price_minor_override;
    });
  useEffect(() => onDirty(stored.branch_id, dirty), [onDirty, stored.branch_id, dirty]);

  const drafted = { branch_id: stored.branch_id, options: diff };
  const f1 = nothingOffered(group, drafted);
  const omitted = menuDone && omittedAt(group, drafted, items);

  function reset(next: ModifierGroupBranch) {
    setStored(next);
    setDraft(draftOf(group, next));
    setStale(false);
    setError(undefined);
    setPriceError(null);
  }

  async function reread() {
    const found = await findChoiceGroup(api, group.modifier_group_id);
    if (!found.ok) {
      setError(errorText(found.error) ?? undefined);
      return;
    }
    const next = found.data.group?.branches.find((b) => b.branch_id === stored.branch_id);
    if (next === undefined) setError(t('errors.NOT_FOUND_stale'));
    else reset(next);
  }

  async function save() {
    setError(undefined);
    setPriceError(null);
    const bad = diff.find((d) => Number.isNaN(d.price_minor_override) || (d.price_minor_override ?? 0) > MAX_PRICE);
    if (bad !== undefined) {
      setPriceError(bad.option_id);
      return;
    }
    setBusy(true);
    const result = await api.putModifierGroupBranch(group.modifier_group_id, stored.branch_id, {
      expected_version: stored.version,
      options: diff,
    });
    setBusy(false);
    if (result.ok) {
      reset(result.data.branch);
      return;
    }
    const code = apiCode(result.error);
    if (code === 'CONFIG_STALE') setStale(true);
    else if (code === 'CONFIG_REFERENCE_INVALID' && result.error.kind === 'api') {
      setError(result.error.details['field'] === 'modifier_group_id' ? t('choice_group.branch_archived') : referenceText(result.error.details));
    } else if (code === 'BRANCH_NOT_FOUND') setError(t('choice_group.branch_gone'));
    else setError(errorText(result.error) ?? undefined);
  }

  const offeredCount = options.filter((o) => draft[o.option_id]?.offered !== false).length;
  const chips = (
    <>
      {f1 ? (
        <span className="pos-chip pos-chip--warn">
          <Icon name="alert" />
          {t('choice_group.nothing_here')}
        </span>
      ) : offeredCount === options.length ? (
        <span className="pos-chip pos-chip--ok">
          <Icon name="check" />
          {fill(t('choice_group.all_offered'), { n: String(options.length) })}
        </span>
      ) : (
        <span className="pos-chip">
          <Icon name="x" />
          {fill(t('choice_group.n_off'), { n: String(options.length - offeredCount) })}
        </span>
      )}
      {diff
        .filter((d) => d.is_offered && !Number.isNaN(d.price_minor_override))
        .map((d) => (
          <span key={d.option_id} className="pos-chip pos-chip--accent">
            {options.find((o) => o.option_id === d.option_id)?.name}{' '}
            <span className="num">{`${t('owner.menu.rupees')} ${shownRupees(d.price_minor_override ?? 0)}`}</span>
          </span>
        ))}
      {omitted && (
        <span className="pos-chip pos-chip--warn">
          <Icon name="alert" />
          {fill(t('choice_groups.omitted'), { branch: name })}
        </span>
      )}
    </>
  );

  return (
    <BranchRow
      name={name}
      chips={chips}
      dirty={dirty}
      busy={busy}
      disabled={down}
      stale={stale}
      error={error}
      onSave={() => void save()}
      onReload={() => void reread()}
    >
      {f1 && (
        <div className="pos-banner pos-banner--warn" role="status" data-f1="">
          <Icon name="alert" />
          <p>
            {fill(t('choice_group.f1'), { group: group.name, branch: name })}
            <small>{t('choice_group.f1_save')}</small>
          </p>
        </div>
      )}
      <div className="pos-brow__opts">
        {options.map((o) => {
          const d = draft[o.option_id] ?? { offered: true, price: '' };
          const set = (change: Partial<Draft>) => setDraft((prev) => ({ ...prev, [o.option_id]: { ...d, ...change } }));
          return (
            <div key={o.option_id} className={`pos-brow__opt${d.offered ? '' : ' is-off'}`} data-option-id={o.option_id}>
              <span>
                {o.name}
                <small>{baseText(o)}</small>
              </span>
              <Switch
                checked={d.offered}
                label={t('choice_group.offered_here')}
                name={fill(t('choice_group.offered_named'), { name: o.name })}
                onChange={(next) => set(next ? { offered: true } : { offered: false, price: '' })}
              />
              <label className={`pos-field${priceError === o.option_id ? ' pos-field--error' : ''}`}>
                <span className="pos-input-affix">
                  <span>{t('owner.menu.rupees')}</span>
                  <input
                    className="pos-input pos-input--mono"
                    name="price_here"
                    inputMode="decimal"
                    placeholder={t('choice_group.same_as_base')}
                    aria-label={fill(t('choice_group.price_here_named'), { name: o.name })}
                    value={d.price}
                    disabled={!d.offered}
                    onChange={(e) => set({ price: e.target.value })}
                  />
                </span>
                {priceError === o.option_id && <span className="pos-field__error">{t('choice_group.price_invalid')}</span>}
              </label>
            </div>
          );
        })}
      </div>
    </BranchRow>
  );
}
