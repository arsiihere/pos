import { useState } from 'react';
import type { CloudAdmin, Jurisdiction, TaxClass } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { Chip } from '../../../components/Chip';
import { List, ListRow } from '../../../components/List';
import { t } from '../../../i18n';
import { useCloudDown } from '../cloud';
import { errorText } from '../form';

// 01a v2.7.1 §8.1 (05 row A-1 (6), R-32, G-31): each active tax class with a Fiscal category picker offering the branch
// jurisdiction's profile categories and None. A pick saves at once with PATCH /v1/admin/tax-classes/:id
// { fiscal_category }; the field lives here, never in the #/menu tax-class form. Tenant-wide (S8): an owner who does not
// cover every branch gets the list read-only, and a refused write (403 tenant_wide_write) is shown, the pick undone.
// "Needs a category" flags a class with none while the jurisdiction has profile rows — the case the billing PUT
// refuses with profile_missing (§6.25); under none and PK every class is one rate_bp tax and needs no category.
export function categoriesOf(jurisdiction: Jurisdiction | undefined): string[] {
  return [...new Set((jurisdiction?.profile_taxes ?? []).map((p) => p.fiscal_category))].sort();
}

export function TaxCategories({
  api,
  jurisdiction,
  taxClasses,
  canEdit,
}: {
  api: CloudAdmin;
  jurisdiction: Jurisdiction | undefined;
  taxClasses: readonly TaxClass[];
  canEdit: boolean;
}) {
  const [picked, setPicked] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const down = useCloudDown(api);
  const categories = categoriesOf(jurisdiction);
  const needsCategories = categories.length > 0;
  const active = taxClasses.filter((c) => c.archived_at === null);

  // A pick of None is `null`, so presence in `picked` (not the value) says the owner has chosen.
  const shown = (c: TaxClass): string | null => (c.tax_class_id in picked ? (picked[c.tax_class_id] ?? null) : c.fiscal_category);

  async function pick(taxClass: TaxClass, value: string) {
    const next = value === '' ? null : value;
    const before = shown(taxClass);
    setPicked((p) => ({ ...p, [taxClass.tax_class_id]: next }));
    setBusy(taxClass.tax_class_id);
    setError(null);
    const result = await api.patchTaxClass(taxClass.tax_class_id, { fiscal_category: next });
    setBusy(null);
    if (result.ok) {
      setPicked((p) => ({ ...p, [taxClass.tax_class_id]: result.data.tax_class.fiscal_category ?? null }));
      return;
    }
    setPicked((p) => ({ ...p, [taxClass.tax_class_id]: before }));
    setError(errorText(result.error));
  }

  return (
    <section className="pos-section pos-settings">
      <div className="pos-section__head">
        <h2>{t('billing.tax_categories')}</h2>
        <p>{t('billing.tax_categories_help')}</p>
      </div>
      {!canEdit && <Banner tone="info" text={t('billing.tax_read_only')} />}
      {error !== null && <Banner tone="danger" text={error} />}
      {active.length === 0 ? (
        <p>{t('billing.tax_none')}</p>
      ) : (
        <List preset="rows">
          {active.map((taxClass) => {
            const value = shown(taxClass);
            // A saved category the catalog no longer lists stays selectable, so the picker never shows a wrong value.
            const options = value !== null && !categories.includes(value) ? [...categories, value].sort() : categories;
            return (
              <ListRow key={taxClass.tax_class_id} attrs={{ 'data-tax-class-id': taxClass.tax_class_id }}>
                <span className="pos-list__name">
                  <strong>{taxClass.name}</strong>
                  {needsCategories && value === null && (
                    <span className="pos-list__tags">
                      <Chip tone="warn">{t('billing.needs_category')}</Chip>
                    </span>
                  )}
                </span>
                <label className="pos-field">
                  <span className="pos-field__label">{t('billing.fiscal_category')}</span>
                  <select
                    className="pos-select"
                    name={`fiscal_category.${taxClass.tax_class_id}`}
                    value={value ?? ''}
                    disabled={!canEdit || down || busy === taxClass.tax_class_id}
                    onChange={(e) => void pick(taxClass, e.target.value)}
                  >
                    <option value="">{t('billing.category_none')}</option>
                    {options.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </ListRow>
            );
          })}
        </List>
      )}
    </section>
  );
}
