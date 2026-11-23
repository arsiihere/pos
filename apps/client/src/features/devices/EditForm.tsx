import { useState } from 'react';
import { BusyButton } from '../../components/BusyButton';
import { t } from '../../i18n';
import type { DeviceRow, DevicesApi, PickPerson, SetProfilePayload } from './api';
import { FormShell, needsPoint, ProfileFields, profileReady, usePlaces, errorText, type Profile } from './ApproveForm';

// 05a §6.4 (task 32): edit a device's profile. `expected_version` is the row's `profile_version`; a 409 CONFIG_STALE
// G-e (v1.0.2): the hub derives the clear, so no point_id without Pass and no staff_ids on everyone are sent.
// keeps what was typed and offers Reload (01b R32). A `kds` device has no profile and is not edited here.

export function EditForm({ api, device, people: directory, onDone, onCancel, onReload }: { api: DevicesApi; device: DeviceRow; people: PickPerson[]; onDone: () => void; onCancel: () => void; onReload: () => void }) {
  const [name, setName] = useState(device.device_name);
  const [profile, setProfile] = useState<Profile>({
    access: device.access ?? 'everyone',
    staffIds: device.people.map((p) => p.staff_id),
    screens: device.screens,
    pointId: device.point_id ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; stale: boolean } | null>(null);
  const { points } = usePlaces(api);
  const have = new Set(directory.map((p) => p.staff_id));
  const people = [...directory, ...device.people.filter((p) => !have.has(p.staff_id))];

  const stale = err?.stale ?? false;
  const submit = async () => {
    setBusy(true);
    setErr(null);
    const payload: SetProfilePayload = {
      device_id: device.device_id,
      expected_version: device.profile_version,
      device_name: name.trim(),
      access: profile.access,
      ...(profile.access === 'listed' ? { staff_ids: profile.staffIds } : {}),
      screens: profile.screens,
      ...(needsPoint(profile.screens) ? { point_id: profile.pointId } : {}),
    };
    const answer = await api.setProfile(payload, api.newCommandId());
    setBusy(false);
    if (answer.ok) onDone();
    else setErr(errorText(answer.error));
  };

  return (
    <FormShell error={err === null || stale ? null : err.text} stale={stale} onReload={onReload}>
      <h2>{t('devices.edit')}</h2>
      <label className="dv__field" data-field="name">
        {t('devices.form.name')}
        <input type="text" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <ProfileFields hardware={device.device_type} value={profile} onChange={setProfile} people={people} points={points} />
      <div className="pos-row">
        <button type="button" className="pos-btn" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <BusyButton primary busy={busy} disabled={stale || name.trim() === '' || !profileReady(profile)} onClick={() => void submit()}>
          {t('devices.save')}
        </BusyButton>
      </div>
    </FormShell>
  );
}
