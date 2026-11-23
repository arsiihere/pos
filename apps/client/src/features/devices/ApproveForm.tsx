import { useEffect, useState, type ReactNode } from 'react';
import { screensOffered, type DeviceType, type ScreenKey } from '@pos/domain';
import type { HubError } from '../../api/hub-admin';
import { Banner } from '../../components/Banner';
import { BusyButton } from '../../components/BusyButton';
import { StaleBanner } from '../../components/StaleBanner';
import { t } from '../../i18n';
import type { MessageKey } from '../../i18n/en';
import type { ApprovePayload, DevicesApi, DeviceRow, PendingRequest, PickPerson, PickPoint, PickStation, SetProfilePayload } from './api';

// 05a §6.3 (approve form, defaults by hint), §6.4 (edit form), §8 (tasks 32): the two forms share the profile fields.
// The display code is the proof the approver stands next to the device: it is typed every time and never prefilled,
// not even when the request is known (`request_id` only picks the request, the hub still matches the code).

export interface Profile {
  access: 'everyone' | 'listed';
  staffIds: string[];
  screens: ScreenKey[];
  pointId: string;
}

/** §6.3 "Form defaults (client)": phone → listed, dine_in; kiosk or no hint → everyone, takeaway + cashier + manager; tablet → everyone, dine_in + manager. */
export function defaultsFor(hint: DeviceType | null): Profile {
  if (hint === 'phone') return { access: 'listed', staffIds: [], screens: ['dine_in'], pointId: '' };
  if (hint === 'tablet') return { access: 'everyone', staffIds: [], screens: ['dine_in', 'manager'], pointId: '' };
  return { access: 'everyone', staffIds: [], screens: ['takeaway', 'cashier', 'manager'], pointId: '' };
}

/** `pass` ⇔ point (§6.3 step 3): a point only with the Pass screen. */
export const needsPoint = (screens: readonly ScreenKey[]) => screens.includes('pass');

export function errorText(error: HubError): { text: string; stale: boolean } {
  if (error.kind === 'signed_out') return { text: t('devices.err.signed_out'), stale: false };
  if (error.kind === 'network') return { text: t('devices.err.network'), stale: false };
  if (error.code === 'CONFIG_STALE') return { text: '', stale: true };
  const key = `devices.err.${error.code}` as MessageKey;
  return { text: t(key in ERR_KEYS ? key : 'devices.err.generic'), stale: false };
}
const ERR_KEYS: Record<string, true> = {
  'devices.err.DEVICE_ACCESS_SELF': true,
  'devices.err.PAIRING_REQUEST_NOT_FOUND': true,
  'devices.err.STATION_NOT_FOUND': true,
  'devices.err.STAFF_NOT_FOUND': true,
  'devices.err.POINT_NOT_FOUND': true,
  'devices.err.DEVICE_NOT_FOUND': true,
  'devices.err.PERMISSION_DENIED': true,
};

const screenLabel = (s: ScreenKey) => t(`alerts.screen.${s}` as MessageKey);

/** Points and stations for the pickers (branch-config snapshot; the spec names no other source). People come from the `devices` reply (§6.8 G-f). */
export function usePlaces(api: DevicesApi) {
  const [points, setPoints] = useState<PickPoint[]>([]);
  const [stations, setStations] = useState<PickStation[]>([]);
  useEffect(() => {
    let live = true;
    void api.places().then((a) => {
      if (!live || !a.ok) return;
      setPoints(a.data.points);
      setStations(a.data.stations);
    });
    return () => {
      live = false;
    };
  }, [api]);
  return { points, stations };
}

/** §6.3: "Counter 2" for a kiosk, "Ali's phone" for a phone (needs the picked person), else "Tablet". */
export function suggestName(hardware: DeviceType, firstPerson: string | null): string {
  if (hardware === 'phone') return firstPerson === null ? '' : `${firstPerson}'s phone`;
  if (hardware === 'cashier_kiosk') return 'Counter 2';
  if (hardware === 'kds') return 'Kitchen screen';
  return 'Tablet 1';
}

export function ProfileFields({
  hardware,
  value,
  onChange,
  people,
  points,
}: {
  hardware: DeviceType;
  value: Profile;
  onChange: (next: Profile) => void;
  people: PickPerson[];
  points: PickPoint[];
}) {
  const offered = screensOffered(hardware);
  const toggle = <V,>(list: V[], v: V) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <>
      <fieldset className="dv__field">
        <legend>{t('devices.form.access')}</legend>
        {(['everyone', 'listed'] as const).map((a) => (
          <label key={a}>
            <input type="radio" name="dv-access" checked={value.access === a} onChange={() => onChange({ ...value, access: a })} />
            {t(a === 'everyone' ? 'devices.everyone' : 'devices.form.listed')}
          </label>
        ))}
      </fieldset>
      {value.access === 'listed' && (
        <fieldset className="dv__field" data-field="people">
          <legend>{t('devices.form.people')}</legend>
          {people.map((p) => (
            <label key={p.staff_id}>
              <input type="checkbox" checked={value.staffIds.includes(p.staff_id)} onChange={() => onChange({ ...value, staffIds: toggle(value.staffIds, p.staff_id) })} />
              {p.display_name}
            </label>
          ))}
        </fieldset>
      )}
      <fieldset className="dv__field" data-field="screens">
        <legend>{t('devices.form.screens')}</legend>
        {offered.map((s) => (
          <label key={s}>
            <input
              type="checkbox"
              checked={value.screens.includes(s)}
              onChange={() => {
                const screens = toggle(value.screens, s);
                onChange({ ...value, screens, pointId: needsPoint(screens) ? value.pointId : '' });
              }}
            />
            {screenLabel(s)}
          </label>
        ))}
      </fieldset>
      {needsPoint(value.screens) && (
        <label className="dv__field" data-field="point">
          {t('devices.form.point')}
          <select value={value.pointId} onChange={(e) => onChange({ ...value, pointId: e.target.value })}>
            <option value="">{t('devices.form.pick')}</option>
            {points.map((p) => (
              <option key={p.point_id} value={p.point_id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}

/** What blocks Save (the hub re-checks every rule). */
export function profileReady(p: Profile): boolean {
  if (p.screens.length === 0) return false;
  if (p.access === 'listed' && (p.staffIds.length < 1 || p.staffIds.length > 20)) return false;
  if (needsPoint(p.screens) && p.pointId === '') return false;
  return true;
}

export function FormShell({ children, error, stale, onReload }: { children: ReactNode; error: string | null; stale: boolean; onReload: () => void }) {
  return (
    <div className="dv__form">
      {stale && <StaleBanner onReload={onReload} />}
      {error !== null && <Banner tone="danger" text={error} />}
      {children}
    </div>
  );
}

const HARDWARE: DeviceType[] = ['tablet', 'cashier_kiosk', 'kds', 'phone'];

export function ApproveForm({
  api,
  request,
  people,
  onDone,
  onCancel,
}: {
  api: DevicesApi;
  people: PickPerson[];
  /** the waiting request this approves, or null for a request the approver has only a code for */
  request: PendingRequest | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const hint = request?.hardware_hint ?? null;
  const [hardware, setHardware] = useState<DeviceType>(hint ?? 'cashier_kiosk');
  const [code, setCode] = useState(''); // always typed, never prefilled (§6.3)
  const given = request?.device_name.trim() ?? '';
  const [name, setName] = useState(given !== '' ? given : suggestName(hint ?? 'cashier_kiosk', null));
  const [edited, setEdited] = useState(given !== '');
  const [profile, setProfile] = useState<Profile>(defaultsFor(hint));
  const [stationId, setStationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; stale: boolean } | null>(null);
  const { points, stations } = usePlaces(api);

  const pickHardware = (h: DeviceType) => {
    setHardware(h);
    setProfile(defaultsFor(h));
    if (!edited) setName(suggestName(h, null));
  };
  const isKds = hardware === 'kds';
  const ready = code.trim() !== '' && name.trim() !== '' && (isKds ? stationId !== '' : profileReady(profile));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    const base = { display_code: code.trim(), device_type: hardware, device_name: name.trim(), ...(request === null ? {} : { request_id: request.request_id }) };
    const payload: ApprovePayload = isKds
      ? { ...base, station_id: stationId }
      : {
          ...base,
          access: profile.access,
          ...(profile.access === 'listed' ? { staff_ids: profile.staffIds } : {}),
          screens: profile.screens,
          ...(needsPoint(profile.screens) ? { point_id: profile.pointId } : {}),
        };
    const answer = await api.approve(payload, api.newCommandId());
    setBusy(false);
    if (answer.ok) onDone();
    else setErr(errorText(answer.error));
  };

  return (
    <FormShell error={err === null || err.stale ? null : err.text} stale={err?.stale ?? false} onReload={onDone}>
      <h2>{t('devices.approve')}</h2>
      <label className="dv__field" data-field="code">
        {t('devices.form.code')}
        <input type="text" inputMode="numeric" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
        <small>{t('devices.form.code_hint')}</small>
      </label>
      <label className="dv__field" data-field="name">
        {t('devices.form.name')}
        <input type="text" maxLength={40} value={name} onChange={(e) => (setEdited(true), setName(e.target.value))} />
      </label>
      <label className="dv__field" data-field="hardware">
        {t('devices.form.hardware')}
        <select value={hardware} onChange={(e) => pickHardware(e.target.value as DeviceType)}>
          {HARDWARE.map((h) => (
            <option key={h} value={h}>
              {t(`devices.hw.${h}` as MessageKey)}
            </option>
          ))}
        </select>
      </label>
      {isKds ? (
        <label className="dv__field" data-field="station">
          {t('devices.form.station')}
          <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">{t('devices.form.pick')}</option>
            {stations.map((s) => (
              <option key={s.station_id} value={s.station_id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <ProfileFields
          hardware={hardware}
          value={profile}
          onChange={(next) => {
            setProfile(next);
            const first = people.find((x) => x.staff_id === next.staffIds[0]);
            if (!edited && hardware === 'phone' && first !== undefined) setName(suggestName('phone', first.display_name));
          }}
          people={people}
          points={points}
        />
      )}
      <div className="pos-row">
        <button type="button" className="pos-btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <BusyButton primary busy={busy} disabled={!ready} onClick={() => void submit()}>
          {t('devices.approve')}
        </BusyButton>
      </div>
    </FormShell>
  );
}

export type { DeviceRow, SetProfilePayload };
