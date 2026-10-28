import type { BranchSettingsPatchRequest } from '@pos/events';
import { useEffect, useState, type ReactNode } from 'react';
import type { BranchDetail, CloudAdmin } from '../../../api/cloud-admin';
import { navigate } from '../../../app/router';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Icon } from '../../../components/Icon';
import { Skeleton } from '../../../components/Skeleton';
import { Switch } from '../../../components/Switch';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { useCloudDown } from '../cloud';
import { errorText } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { Page } from '../Shell';

// 01b §8 #/branches/:id/settings (01b-S07, §6.10, B16): tax on or off, the stale-day hours (1–48) and the
// second Start-day gap (0–12). The form checks the ranges and stale > gap before sending, then PATCHes only
// the changed fields (the server re-checks the merged row).
const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : NaN);

export function BranchSettings({ api, branchId }: { api: CloudAdmin; branchId: string }) {
  const [stored, setStored] = useState<BranchDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void api.getBranchSettings(branchId).then((result) => {
      if (!live) return;
      if (result.ok) setStored(result.data.branch);
      else setLoadError(errorText(result.error));
    });
    return () => {
      live = false;
    };
  }, [api, branchId]);

  const back = (
    <a className="pos-btn" href="#/branches" aria-label={t('branches.back')}>
      <Icon name="back" flip />
      {t('branches.back_short')}
    </a>
  );

  if (stored === null) {
    return (
      <Page api={api} title={t('branches.title')} start={back}>
        {loadError !== null ? <Banner tone="danger" text={loadError} /> : <Skeleton lines={4} />}
      </Page>
    );
  }
  return <SettingsForm key={stored.branch_id} api={api} stored={stored} onStored={setStored} back={back} />;
}

function SettingsForm({
  api,
  stored,
  onStored,
  back,
}: {
  api: CloudAdmin;
  stored: BranchDetail;
  onStored: (next: BranchDetail) => void;
  back: ReactNode;
}) {
  const [tax, setTax] = useState(stored.tax_enabled);
  const [stale, setStale] = useState(String(stored.day_stale_after_hours));
  const [gap, setGap] = useState(String(stored.day_min_gap_hours));
  const [errors, setErrors] = useState<{ stale?: string; gap?: string }>({});
  const [banner, setBanner] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const down = useCloudDown(api);
  const leave = useLeave();

  const staleValue = whole(stale);
  const gapValue = whole(gap);
  const patch: BranchSettingsPatchRequest = {};
  if (tax !== stored.tax_enabled) patch.tax_enabled = tax;
  if (staleValue !== stored.day_stale_after_hours) patch.day_stale_after_hours = staleValue;
  if (gapValue !== stored.day_min_gap_hours) patch.day_min_gap_hours = gapValue;
  const fields: Record<string, string> = {
    tax_enabled: t('branches.tax'),
    day_stale_after_hours: t('branches.stale'),
    day_min_gap_hours: t('branches.gap'),
  };
  const changed = Object.keys(patch).map((k) => fields[k] ?? k);
  useDirtyForm(changed.length === 0 ? null : { name: fill(t('branches.settings_title'), { name: stored.name }), fields: changed });

  async function save() {
    const found: typeof errors = {};
    if (!(staleValue >= 1 && staleValue <= 48)) found.stale = t('branches.stale_range');
    if (!(gapValue >= 0 && gapValue <= 12)) found.gap = t('branches.gap_range');
    else if (found.stale === undefined && !(staleValue > gapValue)) found.gap = fill(t('branches.gap_not_less'), { n: String(staleValue) });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (changed.length === 0) {
      navigate('/branches');
      return;
    }
    setBusy(true);
    setBanner(null);
    const result = await api.patchBranchSettings(stored.branch_id, patch);
    setBusy(false);
    if (result.ok) {
      onStored(result.data.branch);
      setBanner({ tone: 'ok', text: fill(t('branches.settings_saved'), { name: result.data.branch.name }) });
      return;
    }
    if (result.error.kind === 'api' && result.error.code === 'VALIDATION_FAILED') {
      setErrors({ gap: fill(t('branches.gap_not_less'), { n: String(staleValue) }) });
      return;
    }
    setBanner({ tone: 'danger', text: errorText(result.error) ?? '' });
  }

  const actions = (
    <>
      <button type="button" className="pos-btn" onClick={() => leave(() => navigate('/branches'))}>
        {t('common.cancel')}
      </button>
      <BusyButton primary busy={busy} disabled={down} onClick={() => void save()}>
        {t('branches.save_settings')}
      </BusyButton>
    </>
  );

  return (
    <Page api={api} title={fill(t('branches.settings_title'), { name: stored.name })} start={back} end={actions}>
      {banner !== null && <Banner tone={banner.tone} text={banner.text} />}
      <section className="pos-section">
        <div className="pos-section__head">
          <h2>{t('branches.tax')}</h2>
          <p>{t('branches.tax_help')}</p>
        </div>
        <Switch checked={tax} label={t('branches.tax_switch')} onChange={setTax} />
      </section>
      <section className="pos-section">
        <div className="pos-section__head">
          <h2>{t('branches.day')}</h2>
        </div>
        <label className={`pos-field${errors.stale !== undefined ? ' pos-field--error' : ''}`}>
          <span className="pos-field__label">{t('branches.stale')}</span>
          <span className="pos-input-affix">
            <input className="pos-input pos-input--mono" name="day_stale_after_hours" inputMode="numeric" value={stale} onChange={(e) => setStale(e.target.value)} />
            <span>{t('branches.hours')}</span>
          </span>
          {errors.stale !== undefined ? (
            <span className="pos-field__error">{errors.stale}</span>
          ) : (
            <span className="pos-field__help">{t('branches.stale_help')}</span>
          )}
        </label>
        <label className={`pos-field${errors.gap !== undefined ? ' pos-field--error' : ''}`}>
          <span className="pos-field__label">{t('branches.gap')}</span>
          <span className="pos-input-affix">
            <input className="pos-input pos-input--mono" name="day_min_gap_hours" inputMode="numeric" value={gap} onChange={(e) => setGap(e.target.value)} />
            <span>{t('branches.hours')}</span>
          </span>
          {errors.gap !== undefined ? (
            <span className="pos-field__error">{errors.gap}</span>
          ) : (
            <span className="pos-field__help">{t('branches.gap_help')}</span>
          )}
        </label>
      </section>
    </Page>
  );
}
