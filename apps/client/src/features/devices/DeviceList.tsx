import { useCallback, useEffect, useState } from 'react';
import type { DeviceType, ScreenKey } from '@pos/domain';
import { Banner } from '../../components/Banner';
import { Chip } from '../../components/Chip';
import { Icon, type IconName } from '../../components/Icon';
import { Skeleton } from '../../components/Skeleton';
import { t } from '../../i18n';
import type { MessageKey } from '../../i18n/en';
import type { DeviceRow, DevicesApi, DevicesData, PendingRequest } from './api';

// 05a §6.8 (page groups), §3.2 M-8 (warnings), §8 (task 31): the staff `#/devices` page, `manage-devices` holders on a
// listed device. Existing page pattern (PL-1): a title, banners, grouped lists of rows, a Reload on a failed read.
// One read on open and on Reload, nothing on a timer.

export const GROUPS = ['waiting', 'kitchen', 'personal', 'counter', 'floor', 'pass', 'back_office'] as const;
export type GroupKey = (typeof GROUPS)[number];

const BY_FIRST_SCREEN: Record<ScreenKey, Exclude<GroupKey, 'waiting'>> = {
  takeaway: 'counter',
  cashier: 'counter',
  parking: 'counter',
  dine_in: 'floor',
  pass: 'pass',
  manager: 'back_office',
};

/**
 * §6.8 m-15, first match wins: Kitchen (kds), Personal (listed, one person), then by the first screen. A staff device
 * with no screens (no profile, a bug) has no first screen and is listed under Back office, where it is looked at.
 */
export function groupOf(d: DeviceRow): Exclude<GroupKey, 'waiting'> {
  if (d.device_type === 'kds') return 'kitchen';
  if (d.access === 'listed' && d.people.length === 1) return 'personal';
  const first = d.screens[0];
  return first === undefined ? 'back_office' : BY_FIRST_SCREEN[first];
}

const HARDWARE_ICON: Record<DeviceType, IconName> = { tablet: 'grid', cashier_kiosk: 'screen', kds: 'flame', phone: 'user' };

/** Hardware is an icon only, never a heading (§6.8); the label is for screen readers. */
export function HardwareIcon({ hardware }: { hardware: DeviceType | null }) {
  const label = t(hardware === null ? 'devices.hw.unknown' : (`devices.hw.${hardware}` as MessageKey));
  return (
    <span className="dv__hw" data-hardware={hardware ?? 'unknown'} role="img" aria-label={label}>
      <Icon name={hardware === null ? 'screen' : HARDWARE_ICON[hardware]} />
    </span>
  );
}

const groupTitle = (g: GroupKey) => t(`devices.group.${g}` as MessageKey);
const screenText = (s: ScreenKey) => t(`devices.screen.${s}` as MessageKey);

function DeviceItem({ d }: { d: DeviceRow }) {
  const who = d.access === 'listed' ? d.people.map((p) => p.display_name).join(', ') : t('devices.everyone');
  return (
    <li className="dv__row" data-device={d.device_id}>
      <HardwareIcon hardware={d.device_type} />
      <div className="dv__main">
        <strong>{d.device_name}</strong>
        <small>
          {d.device_type === 'kds' ? '' : `${who} · ${d.screens.map(screenText).join(', ')}`}
        </small>
      </div>
      {d.needs_review && <Chip tone="warn">{t('devices.needs_review')}</Chip>}
    </li>
  );
}

function WaitingItem({ r }: { r: PendingRequest }) {
  return (
    <li className="dv__row" data-request={r.request_id}>
      <HardwareIcon hardware={r.hardware_hint} />
      <div className="dv__main">
        <strong>{r.device_name}</strong>
      </div>
    </li>
  );
}

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: DevicesData };

export function DeviceList({ api }: { api: DevicesApi }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    const answer = await api.devices();
    setState(answer.ok ? { status: 'ready', data: answer.data } : { status: 'error' });
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="dv">
      <h1 className="title">{t('devices.title')}</h1>
      {state.status === 'loading' && <Skeleton lines={4} />}
      {state.status === 'error' && (
        <Banner tone="danger" text={t('devices.load_failed')} />
      )}
      {state.status === 'error' && (
        <button type="button" className="pos-btn" onClick={() => void load()}>
          {t('devices.reload')}
        </button>
      )}
      {state.status === 'ready' && <Ready data={state.data} />}
    </section>
  );
}

function Ready({ data }: { data: DevicesData }) {
  const live = data.devices.filter((d) => d.revoked_at === null);
  const rows = (g: GroupKey) => (g === 'waiting' ? [] : live.filter((d) => groupOf(d) === g));
  const shown = GROUPS.filter((g) => (g === 'waiting' ? data.pending_requests.length > 0 : rows(g).length > 0));
  return (
    <>
      {data.admin_warning === 0 && <Banner tone="danger" text={t('devices.warn.none')} />}
      {data.admin_warning === 1 && <Banner tone="warn" text={t('devices.warn.one')} />}
      {shown.length === 0 && <p>{t('devices.empty')}</p>}
      {shown.map((g) => (
        <div key={g} className="dv__group" data-group={g}>
          <h2>{groupTitle(g)}</h2>
          <ul className="dv__list">
            {g === 'waiting' ? data.pending_requests.map((r) => <WaitingItem key={r.request_id} r={r} />) : rows(g).map((d) => <DeviceItem key={d.device_id} d={d} />)}
          </ul>
        </div>
      ))}
    </>
  );
}
