import type { Jurisdiction } from '../../../api/cloud-admin';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { currentRule } from './receipt';

// 01a v2.7.1 §8.1 (05 row A-1 (6), §6.26): the read-only catalog entry of the chosen jurisdiction — its authority, the
// rule in force and its profile taxes. The owner never edits it here; the settings above choose among the entries.
const yes = () => t('billing.yes');
const no = () => t('billing.no');

export function JurisdictionView({ jurisdiction, today }: { jurisdiction: Jurisdiction | undefined; today: string }) {
  if (jurisdiction === undefined) {
    return <section className="pos-section pos-billing__jurisdiction"><p>{t('billing.jurisdiction_unknown')}</p></section>;
  }
  const rule = currentRule(jurisdiction, today);
  const rows: [string, string][] = [
    [t('billing.j.authority'), jurisdiction.adapter_key === 'none' ? t('billing.j.no_authority') : jurisdiction.adapter_key],
    [t('billing.j.currency'), jurisdiction.currency_code ?? t('billing.j.tenant_currency')],
  ];
  if (rule !== undefined) {
    rows.push(
      [t('billing.j.prices_include_tax'), rule.prices_include_tax ? yes() : no()],
      [
        t('billing.j.rounding'),
        rule.rounding_step_minor === null
          ? t('billing.j.no_rounding')
          : fill(t('billing.j.rounding_value'), { step: String(rule.rounding_step_minor), mode: rule.rounding_mode, applies: rule.rounding_applies_to }),
      ],
      [t('billing.j.credit'), rule.credit_support === 'credit_invoice' ? t('billing.j.credit_invoice') : t('billing.j.credit_none')],
      [t('billing.j.effective_from'), rule.effective_from],
    );
    if (rule.receipt_fiscal !== null) rows.push([t('billing.j.fiscal_number'), rule.receipt_fiscal.fiscal_number_label]);
  }
  const categories = [...new Set(jurisdiction.profile_taxes.map((p) => p.fiscal_category))].sort();
  return (
    <section className="pos-section pos-billing__jurisdiction">
      <div className="pos-section__head">
        <h2>{jurisdiction.name}</h2>
        <p>{t('billing.j.help')}</p>
      </div>
      <dl className="pos-billing__facts">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {categories.length === 0 ? (
        <p>{t('billing.j.one_tax')}</p>
      ) : (
        categories.map((category) => (
          <div key={category}>
            <h3>{category}</h3>
            <ul>
              {jurisdiction.profile_taxes
                .filter((p) => p.fiscal_category === category)
                .sort((a, b) => a.seq - b.seq)
                .map((p) => (
                  <li key={`${category}:${p.seq}`}>
                    {p.label} <span className="pos-ltr">({p.tax_code})</span>
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
