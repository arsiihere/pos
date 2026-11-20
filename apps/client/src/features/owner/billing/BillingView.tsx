import { useEffect, useState, type ReactNode } from 'react';
import { usePhone } from '../../../app/phone';
import type { BillingDocument, CloudAdmin, Jurisdiction, TaxClass } from '../../../api/cloud-admin';
import { ActionBar } from '../../../components/ActionBar';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Skeleton } from '../../../components/Skeleton';
import { StaleBanner } from '../../../components/StaleBanner';
import { Switch } from '../../../components/Switch';
import { t, type MessageKey } from '../../../i18n';
import { fill } from '../../../i18n/en';
import { useCloudDown } from '../cloud';
import { errorText, useReveal } from '../form';
import { useDirtyForm } from '../guard';
import { BranchSelect, Page } from '../Shell';
import { useBranchName } from '../branch';
import {
  build,
  changedFields,
  ORDER_TYPES,
  referenceError,
  SHOW_KEYS,
  splitLines,
  toDraft,
  validationErrors,
  parsePercentBp,
  type Draft,
  type ErrorKey,
  type FieldErrors,
} from './form-state';
import { JurisdictionView } from './JurisdictionView';
import { currentRule, previewText, type PreviewWidth } from './receipt';
import { TaxCategories } from './TaxCategories';

// 01a v2.7.1 §8.1 #/billing (05 row A-1 (6)): the owner Billing page for one branch. The settings document of
// §5.2b / §6.25 (GET / PUT with expected_version; a 409 CONFIG_STALE offers Reload), the receipt preview rendered with
// renderText, the read-only jurisdiction view (§6.26) and the Tax categories list. The cloud answers the built-in
// defaults when the branch has no saved document (G-23), so a first visit is the same form. No secret is ever on it (B22).
interface Loaded {
  doc: BillingDocument;
  catalog: Jurisdiction[] | null;
  taxClasses: TaxClass[];
  canEditTenant: boolean;
}

const today = (): string => new Date().toISOString().slice(0, 10);

export function BillingView({
  api,
  branchId,
  branchIds,
  onBranch,
}: {
  api: CloudAdmin;
  branchId: string;
  branchIds: readonly string[];
  onBranch: (branchId: string) => void;
}) {
  const [loaded, setLoaded] = useState<(Loaded & { branchId: string }) | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped by Reload so the form starts again from the document as it is now.
  const [epoch, setEpoch] = useState(0);
  const phone = usePhone();

  async function read(): Promise<{ ok: true; value: Loaded } | { ok: false; text: string | null }> {
    const [billing, catalog, menu] = await Promise.all([api.getBilling(branchId), api.listJurisdictions(), api.getMenu({ status: 'active', limit: 1 })]);
    if (!billing.ok) return { ok: false, text: errorText(billing.error) };
    return {
      ok: true,
      value: {
        doc: billing.data.billing,
        // The catalog (read-only, §6.26) failing leaves the document editable; the jurisdiction parts say so.
        catalog: catalog.ok ? catalog.data.jurisdictions : null,
        taxClasses: menu.ok ? menu.data.tax_classes : [],
        canEditTenant: menu.ok ? menu.data.can_edit_tenant : false,
      },
    };
  }

  useEffect(() => {
    let live = true;
    setLoaded(null);
    setLoadError(null);
    void read().then((result) => {
      if (!live) return;
      if (result.ok) setLoaded({ ...result.value, branchId });
      else setLoadError(result.text ?? '');
    });
    return () => {
      live = false;
    };
  }, [api, branchId]);

  const select = <BranchSelect branchIds={branchIds} value={branchId} onChange={onBranch} />;
  const shell = (body: ReactNode) => (
    <Page api={api} title={t('billing.title')} after={phone ? undefined : select}>
      {phone && <div className="pos-branchpick">{select}</div>}
      {body}
    </Page>
  );

  if (loaded === null || loaded.branchId !== branchId) {
    return shell(loadError !== null ? <Banner tone="danger" text={loadError} /> : <Skeleton lines={6} />);
  }

  async function reload() {
    const result = await read();
    if (result.ok) {
      setLoaded({ ...result.value, branchId });
      setEpoch((n) => n + 1);
    } else setLoadError(result.text ?? '');
  }

  return (
    <BillingForm
      key={`${branchId}:${epoch}`}
      api={api}
      branchId={branchId}
      loaded={loaded}
      onStored={(doc) => setLoaded({ ...loaded, doc })}
      onReload={() => void reload()}
      select={select}
    />
  );
}

function BillingForm({
  api,
  branchId,
  loaded,
  onStored,
  onReload,
  select,
}: {
  api: CloudAdmin;
  branchId: string;
  loaded: Loaded;
  onStored: (doc: BillingDocument) => void;
  onReload: () => void;
  select: ReactNode;
}) {
  const stored = loaded.doc;
  const [draft, setDraft] = useState<Draft>(() => toDraft(stored));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [changedElsewhere, setChangedElsewhere] = useState(false);
  const [busy, setBusy] = useState(false);
  const [width, setWidth] = useState<PreviewWidth>(48);
  const down = useCloudDown(api);
  const phone = usePhone();
  const branchName = useBranchName()(branchId);
  useReveal(changedElsewhere || banner, ['[data-stale]', '.pos-banner--danger', '.pos-banner--ok']);
  useReveal(Object.keys(errors).length > 0 ? errors : null, ['.pos-billing .pos-field--error']);

  const catalog = loaded.catalog ?? [];
  const chosen = catalog.find((j) => j.jurisdiction_id === draft.jurisdiction_id);
  const saved = catalog.find((j) => j.jurisdiction_id === stored.jurisdiction_id);
  const rule = currentRule(chosen, today());
  const labels = rule?.receipt_fiscal ?? null;
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const changed = changedFields(draft, stored);
  useDirtyForm(changed.length === 0 ? null : { name: fill(t('billing.dirty'), { name: branchName }), fields: changed.map((k) => t(`billing.field.${k}` as MessageKey)) });

  // The preview reads the draft; a value that does not parse yet previews as nothing rather than blocking the page.
  const built = build(draft, stored);
  const preview = previewText(
    {
      receipt: built.ok
        ? built.body.receipt
        : { ...stored.receipt, header_lines: splitLines(draft.header).slice(0, 6), footer_lines: splitLines(draft.footer).slice(0, 6), show: { ...draft.show }, invoice_prefix: draft.invoice_prefix.slice(0, 6), address: draft.address || null, phone: draft.phone || null },
      dineInServiceBp: parsePercentBp(draft.service.dine_in) ?? 0,
      fiscal: labels,
    },
    width,
  );

  async function save() {
    const result = build(draft, stored);
    setBanner(null);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    const answer = await api.putBilling(branchId, { ...result.body, expected_version: stored.version });
    setBusy(false);
    if (answer.ok) {
      onStored(answer.data.billing);
      setBanner({ tone: 'ok', text: t('billing.saved') });
      return;
    }
    const error = answer.error;
    if (error.kind === 'api' && error.code === 'CONFIG_STALE') {
      setChangedElsewhere(true);
      return;
    }
    if (error.kind === 'api' && error.code === 'CONFIG_REFERENCE_INVALID') {
      const found = referenceError(error.details);
      if (found.field !== null) setErrors({ [found.field]: found.key });
      else setBanner({ tone: 'danger', text: fill(t('billing.err.unmapped'), { where: whereText(found.path) }) });
      return;
    }
    if (error.kind === 'api' && error.code === 'VALIDATION_FAILED') {
      const found = validationErrors(error.details);
      if (Object.keys(found).length > 0) {
        setErrors(found);
        return;
      }
    }
    setBanner({ tone: 'danger', text: errorText(error) ?? '' });
  }

  // The stored version is the one the next PUT expects; after a save the draft is the saved document.
  const saveButton = (
    <BusyButton primary size={phone ? 'lg block' : undefined} busy={busy} disabled={down || changedElsewhere} onClick={() => void save()}>
      {t('billing.save')}
    </BusyButton>
  );

  const field = (name: string, label: string, control: ReactNode, help?: string) => {
    const error = errors[name];
    return (
      <label className={`pos-field${error !== undefined ? ' pos-field--error' : ''}`}>
        <span className="pos-field__label">{label}</span>
        {control}
        {error !== undefined ? <span className="pos-field__error">{t(`billing.err.${error}` as MessageKey)}</span> : help !== undefined && <span className="pos-field__help">{help}</span>}
      </label>
    );
  };
  const text = (name: string, label: string, value: string, onChange: (v: string) => void, help?: string, mono = false) =>
    field(name, label, <input className={`pos-input${mono ? ' pos-input--mono' : ''}`} name={name} value={value} onChange={(e) => onChange(e.target.value)} />, help);

  const taxRegCodes = labels?.tax_reg_labels ?? [];

  return (
    <Page api={api} title={t('billing.title')} after={phone ? undefined : select} end={phone ? undefined : saveButton}>
      {phone && <div className="pos-branchpick">{select}</div>}
      {loaded.catalog === null && <Banner tone="danger" text={t('billing.catalog_down')} />}
      {changedElsewhere && <StaleBanner onReload={onReload} />}
      {banner !== null && <Banner tone={banner.tone} text={banner.text} />}
      <div className="pos-billing">
        <section className="pos-section pos-settings">
          <div className="pos-section__head">
            <h2>{t('billing.jurisdiction')}</h2>
            <p>{t('billing.jurisdiction_help')}</p>
          </div>
          {field(
            'jurisdiction_id',
            t('billing.jurisdiction'),
            <select className="pos-select" name="jurisdiction_id" value={draft.jurisdiction_id} onChange={(e) => set({ jurisdiction_id: e.target.value })}>
              {!catalog.some((j) => j.jurisdiction_id === draft.jurisdiction_id) && <option value={draft.jurisdiction_id}>{draft.jurisdiction_id}</option>}
              {catalog.map((j) => (
                <option key={j.jurisdiction_id} value={j.jurisdiction_id}>
                  {j.name}
                </option>
              ))}
            </select>,
          )}
        </section>
        <JurisdictionView jurisdiction={chosen} today={today()} />

        <section className="pos-section pos-settings">
          <div className="pos-section__head">
            <h2>{t('billing.service')}</h2>
            <p>{t('billing.service_help')}</p>
          </div>
          {ORDER_TYPES.map((o) =>
            text(`service_charge_bp.${o}`, t(`billing.order.${o}` as MessageKey), draft.service[o], (v) => set({ service: { ...draft.service, [o]: v } }), undefined, true),
          )}
        </section>

        <section className="pos-section pos-settings">
          <div className="pos-section__head">
            <h2>{t('billing.limits')}</h2>
          </div>
          {text('max_discount_pct', t('billing.max_discount'), draft.max_discount_pct, (v) => set({ max_discount_pct: v }), t('billing.max_discount_help'), true)}
          {text('variance_threshold_minor', t('billing.variance'), draft.variance, (v) => set({ variance: v }), t('billing.variance_help'), true)}
          {text('petty_cash_limit_minor', t('billing.petty'), draft.petty, (v) => set({ petty: v }), t('billing.petty_help'), true)}
          {text('open_bill_flag_minutes', t('billing.open_bill'), draft.open_bill_flag_minutes, (v) => set({ open_bill_flag_minutes: v }), t('billing.open_bill_help'), true)}
        </section>

        <section className="pos-section pos-settings">
          <div className="pos-section__head">
            <h2>{t('billing.receipt')}</h2>
            <p>{t('billing.receipt_help')}</p>
          </div>
          {field('receipt.header_lines', t('billing.header'), <textarea className="pos-input" name="receipt.header_lines" rows={3} value={draft.header} onChange={(e) => set({ header: e.target.value })} />, t('billing.lines_help'))}
          {field('receipt.footer_lines', t('billing.footer'), <textarea className="pos-input" name="receipt.footer_lines" rows={3} value={draft.footer} onChange={(e) => set({ footer: e.target.value })} />, t('billing.lines_help'))}
          {text('receipt.address', t('billing.address'), draft.address, (v) => set({ address: v }))}
          {text('receipt.phone', t('billing.phone'), draft.phone, (v) => set({ phone: v }), undefined, true)}
          {text('receipt.invoice_prefix', t('billing.prefix'), draft.invoice_prefix, (v) => set({ invoice_prefix: v }), t('billing.prefix_help'), true)}
          {taxRegCodes.map((l) =>
            text(`${'receipt.tax_registrations.'}${l.code}`, l.label, draft.registrations[l.code] ?? '', (v) => set({ registrations: { ...draft.registrations, [l.code]: v } }), undefined, true),
          )}
          <div className="pos-settings__switches">
            {SHOW_KEYS.map((k) => (
              <Switch key={k} checked={draft.show[k]} name={t(`billing.show.${k}` as MessageKey)} label={t(`billing.show.${k}` as MessageKey)} onChange={(on) => set({ show: { ...draft.show, [k]: on } })} />
            ))}
          </div>
        </section>

        <section className="pos-section pos-billing__previewbox">
          <div className="pos-section__head">
            <h2>{t('billing.preview')}</h2>
            <p>{t('billing.preview_help')}</p>
          </div>
          <label className="pos-field">
            <span className="pos-field__label">{t('billing.paper')}</span>
            <select className="pos-select" name="preview_width" value={String(width)} onChange={(e) => setWidth(e.target.value === '32' ? 32 : 48)}>
              <option value="48">{t('billing.paper_80')}</option>
              <option value="32">{t('billing.paper_58')}</option>
            </select>
          </label>
          <pre className="pos-billing__preview pos-ltr">{preview}</pre>
        </section>

        <section className="pos-section pos-settings">
          <div className="pos-section__head">
            <h2>{t('billing.fiscal')}</h2>
            <p>{t('billing.fiscal_help')}</p>
          </div>
          {field(
            'fiscal.environment',
            t('billing.environment'),
            <select className="pos-select" name="fiscal.environment" value={draft.environment} onChange={(e) => set({ environment: e.target.value === 'production' ? 'production' : 'sandbox' })}>
              <option value="sandbox">{t('billing.env_sandbox')}</option>
              <option value="production">{t('billing.env_production')}</option>
            </select>,
          )}
          {field(
            'fiscal.integration_status',
            t('billing.integration_status'),
            <select className="pos-select" name="fiscal.integration_status" value={draft.integration_status} onChange={(e) => set({ integration_status: e.target.value === 'not_integrated' ? 'not_integrated' : 'integrated' })}>
              <option value="integrated">{t('billing.integrated')}</option>
              <option value="not_integrated">{t('billing.not_integrated')}</option>
            </select>,
            t('billing.integration_status_help'),
          )}
          {field(
            'fiscal.default_pos_id',
            t('billing.default_pos'),
            <select className="pos-select" name="fiscal.default_pos_id" value={draft.default_pos_id} onChange={(e) => set({ default_pos_id: e.target.value })}>
              <option value="">{t('billing.none')}</option>
              {stored.fiscal.pos_ids.map((p) => (
                <option key={p.pos_id} value={p.pos_id}>
                  {p.label}
                </option>
              ))}
            </select>,
          )}
          <div className="pos-settings__switches">
            {ORDER_TYPES.map((o) => (
              <Switch key={o} checked={draft.fiscalize[o]} name={fill(t('billing.fiscalize'), { type: t(`billing.order.${o}` as MessageKey) })} label={fill(t('billing.fiscalize'), { type: t(`billing.order.${o}` as MessageKey) })} onChange={(on) => set({ fiscalize: { ...draft.fiscalize, [o]: on } })} />
            ))}
          </div>
        </section>

        <section className="pos-section pos-settings">
          <div className="pos-section__head">
            <h2>{t('billing.payment_modes')}</h2>
            <p>{t('billing.payment_modes_help')}</p>
          </div>
          <ul>
            {stored.payment_modes.map((m) => (
              <li key={m.mode_id}>
                {m.name} <span>{m.is_active ? t('billing.mode_active') : t('billing.mode_off')}</span>
              </li>
            ))}
          </ul>
        </section>

        <TaxCategories api={api} jurisdiction={saved} taxClasses={loaded.taxClasses} canEdit={loaded.canEditTenant} />
      </div>
      {phone && (
        <div className="pos-pagebar">
          <ActionBar>{saveButton}</ActionBar>
        </div>
      )}
    </Page>
  );
}

// A cloud path with no input on the page, named by its section (a payment mode, an adapter setting, a rate override).
function whereText(path: string): string {
  if (path.startsWith('payment_modes')) return t('billing.payment_modes');
  if (path.startsWith('fiscal.adapter_settings')) return t('billing.adapter_settings');
  if (path.startsWith('receipt.tax_registrations')) return t('billing.receipt');
  if (path.startsWith('rate_overrides') || path.startsWith('service_charge_tax_profile_id')) return t('billing.rates');
  return path;
}

export type { ErrorKey };
