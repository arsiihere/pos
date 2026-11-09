import { PERMISSIONS, type Permission } from '@pos/domain';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { StaffPatchRequest } from '@pos/events';
import type { Branch, CloudAdmin, CloudError, FloorWithZones, Role, Staff } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { navigate } from '../../../app/router';
import { ActionBar } from '../../../components/ActionBar';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Chip } from '../../../components/Chip';
import { Dialog } from '../../../components/Dialog';
import { Disclosure } from '../../../components/Disclosure';
import { Icon } from '../../../components/Icon';
import { MoreMenu } from '../../../components/MoreMenu';
import { Skeleton } from '../../../components/Skeleton';
import { StaleBanner } from '../../../components/StaleBanner';
import { fill } from '../../../i18n/en';
import { t, typeClass, type MessageKey } from '../../../i18n';
import { useCloudDown } from '../cloud';
import { errorText, ownAdminText, isKeyMismatch, useIdempotencyKey } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { Page } from '../Shell';
import { PinDialog } from './PinDialog';
import { canDetail, canRows, floorsRole, joinNames, shortDate } from './people';
import { noteSaved } from './StaffList';

// 01b §8 #/staff/new and #/staff/:id (01b-S02, C02, D02): who, roles, branches, a lead per branch (B1),
// floors per branch when a role uses "Their floors", the owner's "Never allow" list, PIN and status. C02
// is computed here with the §3.3 rule. An edit sends `expected_version` and only the changed fields (each
// list whole, §6.4); `409 CONFIG_STALE` shows "Changed elsewhere" and keeps the draft editable and copyable;
// Reload discards it and reads the current version; nothing is retried (owner decision 2026-10-30, 01b
// proposal P1; same as 01c §8).

interface Loaded {
  staff: Staff[]; // active and left
  roles: Role[];
  branches: Branch[];
}

interface Draft {
  name: string;
  roleIds: string[];
  branchIds: string[];
  denied: Permission[];
  leads: Record<string, string>; // branch → lead staff id ('' = nobody)
  floors: Record<string, string[]>; // branch → floor ids
  assigned: Record<string, { zones: string[]; tables: string[] }>; // branch → order-taker zones and tables (01b §3.2 rule 7)
  active: boolean;
}

type FieldKey = 'name' | 'roles' | 'branches' | 'assignments';

function draftOf(person: Staff | null): Draft {
  return {
    name: person?.display_name ?? '',
    roleIds: [...(person?.role_ids ?? [])],
    branchIds: [...(person?.branch_ids ?? [])],
    denied: [...(person?.denied_permissions ?? [])],
    leads: Object.fromEntries((person?.reports_to ?? []).map((r) => [r.branch_id, r.lead_staff_id])),
    floors: Object.fromEntries((person?.floors ?? []).map((f) => [f.branch_id, [...f.floor_ids]])),
    assigned: Object.fromEntries((person?.assignments ?? []).map((a) => [a.branch_id, { zones: [...a.zone_ids], tables: [...a.table_ids] }])),
    active: person?.is_active ?? true,
  };
}

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (list: readonly string[]) => [...list].sort();

function body(draft: Draft) {
  const given = draft.branchIds.filter((b) => (draft.assigned[b]?.zones.length ?? 0) + (draft.assigned[b]?.tables.length ?? 0) > 0);
  return {
    display_name: draft.name.trim(),
    role_ids: draft.roleIds,
    branch_ids: draft.branchIds,
    denied_permissions: draft.denied,
    reports_to: draft.branchIds.flatMap((b) => {
      const lead = draft.leads[b] ?? '';
      return lead === '' ? [] : [{ branch_id: b, lead_staff_id: lead }];
    }),
    floors: draft.branchIds.flatMap((b) => {
      const ids = draft.floors[b] ?? [];
      return ids.length === 0 ? [] : [{ branch_id: b, floor_ids: ids }];
    }),
    ...(given.length === 0 ? {} : { assignments: assignmentsOf(draft, given) }),
  };
}

// §3.2 rule 7 / AD-23: whole entries, one per branch given, only for branches the person works at.
function assignmentsOf(draft: Draft, branches: readonly string[]) {
  return branches.map((b) => ({ branch_id: b, zone_ids: draft.assigned[b]?.zones ?? [], table_ids: draft.assigned[b]?.tables ?? [] }));
}

// §6.4: only what changed; lists compared as sets (the server stores them as sets).
function patchOf(person: Staff, draft: Draft): Omit<StaffPatchRequest, 'expected_version'> {
  const next = body(draft);
  const patch: Omit<StaffPatchRequest, 'expected_version'> = {};
  if (next.display_name !== person.display_name) patch.display_name = next.display_name;
  if (!same(sorted(next.role_ids), sorted(person.role_ids))) patch.role_ids = next.role_ids;
  if (!same(sorted(next.branch_ids), sorted(person.branch_ids))) patch.branch_ids = next.branch_ids;
  if (!same(sorted(next.denied_permissions), sorted(person.denied_permissions))) patch.denied_permissions = next.denied_permissions;
  const leads = (list: Staff['reports_to']) => sorted(list.map((r) => `${r.branch_id}:${r.lead_staff_id}`));
  if (!same(leads(next.reports_to), leads(person.reports_to))) patch.reports_to = next.reports_to;
  const floors = (list: Staff['floors']) => sorted(list.flatMap((f) => f.floor_ids.map((id) => `${f.branch_id}:${id}`)));
  if (!same(floors(next.floors), floors(person.floors))) patch.floors = next.floors;
  // AD-23: only the branches the user changed, each as a whole entry; `[]` lists clear a branch.
  const held = (b: string) => person.assignments.find((a) => a.branch_id === b);
  const changed = draft.branchIds.filter((b) => {
    const was = held(b);
    const now = draft.assigned[b];
    return !same(sorted(now?.zones ?? []), sorted(was?.zone_ids ?? [])) || !same(sorted(now?.tables ?? []), sorted(was?.table_ids ?? []));
  });
  if (changed.length > 0) patch.assignments = assignmentsOf(draft, changed);
  if (draft.active !== person.is_active) patch.is_active = draft.active;
  return patch;
}

const FIELD_LABEL: Record<string, MessageKey> = {
  display_name: 'staff.name',
  role_ids: 'staff.roles',
  branch_ids: 'staff.works_at',
  denied_permissions: 'staff.never',
  reports_to: 'staff.reports_to',
  floors: 'staff.floors',
  assignments: 'staff.assigned',
  is_active: 'staff.status',
};

export function StaffForm({ api, staffId, branchIds }: { api: CloudAdmin; staffId: string | null; branchIds: readonly string[] }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped by Reload: the form is rebuilt from the fresh copy.
  const [generation, setGeneration] = useState(0);

  const load = useCallback(async () => {
    const [active, left, roles, branches] = await Promise.all([
      api.listStaff({}),
      api.listStaff({ status: 'left' }),
      api.listRoles(),
      api.listBranches(),
    ]);
    if (active.ok && left.ok && roles.ok && branches.ok) {
      setLoaded({ staff: [...active.data.staff, ...left.data.staff], roles: roles.data.roles, branches: branches.data.branches });
      setLoadError(null);
      setGeneration((g) => g + 1);
      return;
    }
    const failed = [active, left, roles, branches].find((r) => !r.ok);
    if (failed !== undefined && !failed.ok) setLoadError(errorText(failed.error));
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = <BackLink />;

  if (loaded === null) {
    return (
      <Page api={api} title={t('staff.title')} start={back}>
        {loadError !== null ? <Banner tone="danger" text={loadError} /> : <Skeleton lines={6} />}
      </Page>
    );
  }
  const person = staffId === null ? null : (loaded.staff.find((s) => s.staff_id === staffId) ?? null);
  if (staffId !== null && person === null) {
    return (
      <Page api={api} title={t('staff.title')} start={back}>
        <div className="pos-screen pos-screen--info pos-staff__gone">
          <div className="pos-screen__icon">
            <Icon name="search" />
          </div>
          <h2 className="pos-screen__title">{t('staff.not_found')}</h2>
          <p className="pos-screen__body">{t('staff.not_found_body')}</p>
          <a className="pos-btn pos-btn--primary pos-btn--lg" href="#/staff">
            {t('staff.back')}
          </a>
        </div>
      </Page>
    );
  }
  return (
    <Editor
      key={generation}
      api={api}
      loaded={loaded}
      person={person}
      branchIds={branchIds}
      back={back}
      onReload={() => void load()}
    />
  );
}

// Phone (StaffFormPhone): the back arrow alone.
// It goes through the unsaved-changes guard (S50 c) like Cancel does.
function BackLink() {
  const phone = usePhone();
  const leave = useLeave();
  return (
    <a
      className="pos-btn"
      href="#/staff"
      aria-label={t('staff.back')}
      onClick={(e) => {
        e.preventDefault();
        leave(() => navigate('/staff'));
      }}
    >
      <Icon name="back" flip />
      {!phone && t('staff.title')}
    </a>
  );
}

function Editor({
  api,
  loaded,
  person,
  branchIds,
  back,
  onReload,
}: {
  api: CloudAdmin;
  loaded: Loaded;
  person: Staff | null;
  branchIds: readonly string[];
  back: ReactNode;
  onReload: () => void;
}) {
  const [stored, setStored] = useState<Staff | null>(person);
  const [draft, setDraft] = useState<Draft>(() => draftOf(person));
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [banner, setBanner] = useState<{ tone: 'danger' | 'warn'; text: string; detail?: string } | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // C02 (hand-off 01b-C02): a collapsed summary card until tapped.
  const [canOpen, setCanOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [floorLists, setFloorLists] = useState<Record<string, FloorWithZones[]>>({});
  const { key, renew } = useIdempotencyKey();
  const down = useCloudDown(api);
  const leave = useLeave();
  const phone = usePhone();

  const roles = useMemo(() => new Map(loaded.roles.map((r) => [r.role_id, r])), [loaded.roles]);
  const activeRoles = loaded.roles.filter((r) => r.archived_at === null);
  const branchById = new Map(loaded.branches.map((b) => [b.branch_id, b]));
  const name = (id: string) => branchById.get(id)?.name ?? id;
  const tenantBranches = branchIds.filter((id) => branchById.has(id));
  const floorRole = floorsRole(roles, draft.roleIds);
  const title = person === null ? t('staff.new_title') : fill(t('staff.edit_title'), { name: person.display_name });

  // Floors (with their zones and tables, 01a §6.2) are read per branch the person works at; the floors
  // picker and the assigned-tables picker both use them.
  const floorBranches = draft.branchIds.filter((b) => floorLists[b] === undefined).join(',');
  useEffect(() => {
    if (floorBranches === '') return;
    let live = true;
    for (const b of floorBranches.split(',')) {
      void api.listFloors(b).then((result) => {
        if (live && result.ok) setFloorLists((prev) => ({ ...prev, [b]: result.data.floors }));
      });
    }
    return () => {
      live = false;
    };
  }, [api, floorBranches]);

  const patch = stored === null ? null : patchOf(stored, draft);
  const changedFields =
    stored === null
      ? draft.name.trim() !== '' || draft.roleIds.length > 0 || draft.branchIds.length > 0
        ? [t('staff.who')]
        : []
      : Object.keys(patch ?? {}).map((field) => t(FIELD_LABEL[field] ?? 'staff.who'));
  useDirtyForm(changedFields.length === 0 ? null : { name: draft.name.trim() || title, fields: changedFields });

  function update(next: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...next }));
  }

  function validate(): boolean {
    const found: Partial<Record<FieldKey, string>> = {};
    const trimmed = draft.name.trim();
    if (trimmed === '' || trimmed.length > 40) found.name = t('staff.name_required');
    if (draft.roleIds.length === 0) found.roles = t('staff.roles_required');
    if (draft.branchIds.length === 0) found.branches = t('staff.works_at_required');
    setErrors(found);
    const n = Object.keys(found).length;
    if (n > 0) {
      setBanner({
        tone: 'danger',
        text: n === 1 ? t('staff.fix_one') : fill(t('staff.fix_count'), { n: String(n) }),
        detail: (Object.keys(found) as FieldKey[]).map((k) => t(k === 'name' ? 'staff.name' : k === 'roles' ? 'staff.roles' : 'staff.works_at')).join(', '),
      });
    }
    return n === 0;
  }

  // §8 error mapping: a field when the code names one, the reload message on CONFIG_STALE, else a banner.
  function showError(error: CloudError) {
    if (error.kind === 'network') {
      setBanner({ tone: 'warn', text: t('staff.offline') });
      return;
    }
    if (error.kind === 'api') {
      const ids = Array.isArray(error.details['branch_ids']) ? (error.details['branch_ids'] as string[]) : [];
      switch (error.code) {
        case 'CONFIG_STALE':
          setStale(true);
          setBanner(null);
          return;
        case 'STAFF_NAME_TAKEN':
          setErrors({ name: t('errors.STAFF_NAME_TAKEN') });
          setBanner({ tone: 'danger', text: t('staff.fix_one'), detail: t('staff.name') });
          return;
        case 'CONFIG_REFERENCE_INVALID':
          if (error.details['field'] === 'assignments' && error.details['reason'] === 'already_assigned') {
            const holder = loaded.staff.find((p) => p.staff_id === error.details['staff_id'])?.display_name;
            const text = t('errors.reference.already_assigned');
            setErrors({ assignments: holder === undefined ? text : `${text} (${holder})` });
            setBanner({ tone: 'danger', text: t('staff.fix_one'), detail: t('staff.assigned') });
            return;
          }
          break;
        case 'OWN_ADMIN_ACCESS':
          setErrors({
            roles: ownAdminText(error.details),
          });
          setBanner({ tone: 'danger', text: t('staff.fix_one'), detail: t('staff.roles') });
          return;
        case 'LAST_ADMIN_REQUIRED':
          setErrors({ roles: `${t('errors.LAST_ADMIN_REQUIRED')} (${joinNames(ids.map(name))})` });
          setBanner({ tone: 'danger', text: t('staff.fix_one'), detail: t('staff.roles') });
          return;
      }
    }
    setBanner({ tone: 'danger', text: errorText(error) ?? '' });
  }

  async function save() {
    if (!validate()) return;
    setBanner(null);
    if (stored === null) {
      setBusy(true);
      const result = await api.createStaff(body(draft), key);
      setBusy(false);
      if (result.ok) {
        renew();
        noteSaved(fill(t('staff.saved'), { name: result.data.staff.display_name }));
        setDraft(draftOf(result.data.staff));
        navigate('/staff');
        return;
      }
      if (isKeyMismatch(result.error)) renew();
      showError(result.error);
      return;
    }
    if (patch === null || Object.keys(patch).length === 0) {
      navigate('/staff');
      return;
    }
    setBusy(true);
    const result = await api.patchStaff(stored.staff_id, { expected_version: stored.version, ...patch });
    setBusy(false);
    if (result.ok) {
      setStored(result.data.staff);
      setDraft(draftOf(result.data.staff));
      noteSaved(fill(t('staff.saved'), { name: result.data.staff.display_name }));
      navigate('/staff');
      return;
    }
    showError(result.error);
  }

  const more = stored !== null && stored.is_active && (
        <MoreMenu
          label={t('staff.more')}
          info={{ title: t('staff.working'), detail: t('staff.menu_info') }}
          items={[
            {
              label: fill(t('staff.menu_left'), { name: stored.display_name }),
              icon: 'logout',
              danger: true,
              disabled: down || stale,
              onSelect: () => setLeaving(true),
            },
          ]}
        />
  );
  const buttons = (
    <>
      <button type="button" className="pos-btn" onClick={() => leave(() => navigate('/staff'))}>
        {t('common.cancel')}
      </button>
      <BusyButton primary={!stale} busy={busy} disabled={down || stale} onClick={() => void save()}>
        {t('staff.save')}
      </BusyButton>
    </>
  );

  const rows = canRows(roles, { role_ids: draft.roleIds, denied: draft.denied }, stored);
  const ordered = [...rows.filter((r) => r.changed), ...rows.filter((r) => !r.changed)];
  const visible = showAll ? ordered : ordered.slice(0, 6);
  const who = draft.name.trim() || t('staff.new_title');
  const counts = {
    allowed: rows.filter((r) => r.effective.grant === 'allowed').length,
    approval: rows.filter((r) => r.effective.grant === 'requires_approval').length,
    never: rows.filter((r) => r.effective.grant === 'denied').length,
  };
  const bringBackNeedsRole = stored !== null && !stored.is_active && draft.active && draft.roleIds.length === 0;

  return (
    <Page
      api={api}
      title={title}
      start={back}
      end={
        phone ? (
          more || undefined
        ) : (
          <>
            {more}
            {buttons}
          </>
        )
      }
    >
      {stale && <StaleBanner onReload={onReload} />}
      {banner !== null && <Banner tone={banner.tone} text={banner.text} detail={banner.detail} />}
      <div className="pos-split pos-staffform">
        <div className="pos-stack pos-staffform__main">
          <section className="pos-section">
            <div className="pos-section__head">
              <h2>{t('staff.who')}</h2>
            </div>
            <label className={`pos-field${errors.name !== undefined ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{t('staff.name')}</span>
              <input
                className="pos-input"
                name="display_name"
                maxLength={40}
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
              />
              {errors.name !== undefined ? (
                <span className="pos-field__error">{errors.name}</span>
              ) : (
                <span className="pos-field__help">{t('staff.name_help')}</span>
              )}
            </label>
            <div className={`pos-field${errors.roles !== undefined ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{t('staff.roles')}</span>
              <div className="pos-row" role="group" aria-label={t('staff.roles')}>
                {activeRoles.map((r) => (
                  <button
                    key={r.role_id}
                    type="button"
                    className="pos-chip"
                    aria-pressed={draft.roleIds.includes(r.role_id)}
                    onClick={() => update({ roleIds: toggle(draft.roleIds, r.role_id) })}
                  >
                    {draft.roleIds.includes(r.role_id) && <Icon name="check" />}
                    {r.name}
                  </button>
                ))}
              </div>
              {errors.roles !== undefined ? (
                <span className="pos-field__error">{errors.roles}</span>
              ) : (
                <span className="pos-field__help">{bringBackNeedsRole ? t('staff.bring_back_role') : t('staff.roles_help')}</span>
              )}
            </div>
            <div className={`pos-field${errors.branches !== undefined ? ' pos-field--error' : ''}`}>
              <span className="pos-field__label">{t('staff.works_at')}</span>
              <div className="pos-row" role="group" aria-label={t('staff.works_at')}>
                {tenantBranches.map((b) => (
                  <button
                    key={b}
                    type="button"
                    className="pos-chip"
                    aria-pressed={draft.branchIds.includes(b)}
                    onClick={() => update({ branchIds: toggle(draft.branchIds, b) })}
                  >
                    {draft.branchIds.includes(b) && <Icon name="check" />}
                    {branchById.get(b)?.status === 'pending_hub' ? fill(t('staff.not_open'), { name: name(b) }) : name(b)}
                  </button>
                ))}
              </div>
              {errors.branches !== undefined ? (
                <span className="pos-field__error">{errors.branches}</span>
              ) : (
                <span className="pos-field__help">{t('staff.works_at_help')}</span>
              )}
            </div>
          </section>

          {draft.branchIds.length > 0 && (
            <section className="pos-section">
              <div className="pos-section__head">
                <h2>{t('staff.reports_to')}</h2>
                <p>{t('staff.reports_to_help')}</p>
              </div>
              <div className="pos-perbranch">
                {draft.branchIds.map((b) => (
                  <div key={b} className="pos-perbranch__row">
                    <span className="pos-field__label">{fill(t('staff.at_branch'), { branch: name(b) })}</span>
                    <select
                      className="pos-select"
                      name={`lead_${b}`}
                      aria-label={fill(t('staff.reports_to_at'), { branch: name(b) })}
                      value={draft.leads[b] ?? ''}
                      onChange={(e) => update({ leads: { ...draft.leads, [b]: e.target.value } })}
                    >
                      <option value="">{t('staff.nobody')}</option>
                      {loaded.staff
                        .filter((s) => s.is_active && s.staff_id !== stored?.staff_id && s.branch_ids.includes(b))
                        .map((s) => (
                          <option key={s.staff_id} value={s.staff_id}>
                            {s.display_name}
                          </option>
                        ))}
                    </select>
                  </div>
                ))}
              </div>
            </section>
          )}

          {floorRole !== null && draft.branchIds.length > 0 && (
            <section className="pos-section">
              <div className="pos-section__head">
                <h2>{t('staff.floors')}</h2>
                <p>{fill(t('staff.floors_help'), { role: floorRole.name })}</p>
              </div>
              <div className="pos-perbranch">
                {draft.branchIds.map((b) => {
                  const floors = floorLists[b]?.filter((f) => f.archived_at === null);
                  return (
                    <div key={b} className="pos-perbranch__row">
                      <span className="pos-field__label">{fill(t('staff.at_branch'), { branch: name(b) })}</span>
                      {floors === undefined ? (
                        <Skeleton lines={1} />
                      ) : floors.length === 0 ? (
                        <p className={typeClass('caption')}>{t('staff.no_floors')}</p>
                      ) : (
                        <div className="pos-row" role="group" aria-label={fill(t('staff.at_branch'), { branch: name(b) })}>
                          {floors.map((f) => (
                            <button
                              key={f.floor_id}
                              type="button"
                              className="pos-chip"
                              aria-pressed={(draft.floors[b] ?? []).includes(f.floor_id)}
                              onClick={() => update({ floors: { ...draft.floors, [b]: toggle(draft.floors[b] ?? [], f.floor_id) } })}
                            >
                              {(draft.floors[b] ?? []).includes(f.floor_id) && <Icon name="check" />}
                              {f.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {draft.branchIds.length > 0 && (
            <section className="pos-section" data-field="assignments">
              <div className="pos-section__head">
                <h2>{t('staff.assigned')}</h2>
                <p>{t('staff.assigned_help')}</p>
              </div>
              <div className="pos-perbranch">
                {draft.branchIds.map((b) => {
                  const layout = floorLists[b];
                  const mine = draft.assigned[b] ?? { zones: [], tables: [] };
                  // Archived ones show only while the person holds them (AD-31); never as a new choice.
                  const zones = (layout ?? []).flatMap((f) => (f.archived_at === null ? f.zones : [])).filter((z) => z.archived_at === null || mine.zones.includes(z.zone_id));
                  const tables = (layout ?? []).flatMap((f) => (f.archived_at === null ? f.tables : [])).filter((x) => x.archived_at === null || mine.tables.includes(x.table_id));
                  const chip = (id: string, label: string, archived: boolean, on: boolean, flip: () => void) => (
                    <button key={id} type="button" className="pos-chip" aria-pressed={on} onClick={flip}>
                      {on && <Icon name="check" />}
                      {archived ? `${label} (${t('staff.assigned_archived')})` : label}
                    </button>
                  );
                  return (
                    <div key={b} className="pos-perbranch__row">
                      <span className="pos-field__label">{fill(t('staff.at_branch'), { branch: name(b) })}</span>
                      {layout === undefined ? (
                        <Skeleton lines={1} />
                      ) : zones.length === 0 && tables.length === 0 ? (
                        <p className={typeClass('caption')}>{t('staff.assigned_none')}</p>
                      ) : (
                        <>
                          {zones.length > 0 && (
                            <div className="pos-row" role="group" aria-label={`${t('staff.assigned_zones')}, ${name(b)}`}>
                              {zones.map((z) =>
                                chip(z.zone_id, z.name, z.archived_at !== null, mine.zones.includes(z.zone_id), () =>
                                  update({ assigned: { ...draft.assigned, [b]: { ...mine, zones: toggle(mine.zones, z.zone_id) } } }),
                                ),
                              )}
                            </div>
                          )}
                          {tables.length > 0 && (
                            <div className="pos-row" role="group" aria-label={`${t('staff.assigned_tables')}, ${name(b)}`}>
                              {tables.map((x) =>
                                chip(x.table_id, x.name, x.archived_at !== null, mine.tables.includes(x.table_id), () =>
                                  update({ assigned: { ...draft.assigned, [b]: { ...mine, tables: toggle(mine.tables, x.table_id) } } }),
                                ),
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {errors.assignments !== undefined && <span className="pos-field__error">{errors.assignments}</span>}
            </section>
          )}

          {stored !== null && stored.is_active && (
            <section className="pos-section">
              <div className="pos-row pos-row--apart">
                <div className="pos-section__head">
                  <h2>{t('staff.pin')}</h2>
                  <p>
                    {stored.has_pin && stored.pin_set_at !== null
                      ? fill(t('staff.pin_set_on'), { date: shortDate(stored.pin_set_at) })
                      : t('staff.pin_none')}
                  </p>
                </div>
                <button type="button" className="pos-btn" disabled={down} onClick={() => setPinOpen(true)}>
                  <Icon name="lock" />
                  {stored.has_pin ? t('staff.reset_pin') : t('staff.set_pin')}
                </button>
              </div>
            </section>
          )}

          {/* Hand-off 01b-S02: RARE, owner-only — one disclosure row, open when the person has a block. */}
          <Disclosure
            icon="block"
            inPlace
            defaultOpen={draft.denied.length > 0}
            title={t('staff.advanced_never')}
            summary={draft.denied.length === 0 ? t('staff.never_none') : fill(t('staff.never_count'), { n: String(draft.denied.length) })}
          >
            <section className="pos-section">
              <div className="pos-row pos-row--apart">
                <div className="pos-section__head">
                  <h2>{t('staff.never')}</h2>
                  <p>{t('staff.never_help')}</p>
                </div>
                <button type="button" className="pos-btn" onClick={() => setAdding(true)}>
                  <Icon name="plus" />
                  {t('staff.never_add')}
                </button>
              </div>
              {adding && (
                <select
                  className="pos-select"
                  aria-label={t('staff.never_pick')}
                  value=""
                  onChange={(e) => {
                    update({ denied: [...draft.denied, e.target.value as Permission] });
                    setAdding(false);
                  }}
                >
                  <option value="" />
                  {PERMISSIONS.filter((p) => !draft.denied.includes(p)).map((p) => (
                    <option key={p} value={p}>
                      {t(`perm.${p}`)}
                    </option>
                  ))}
                </select>
              )}
              {draft.denied.length === 0 ? (
                <p className={typeClass('body')}>{t('staff.never_none')}</p>
              ) : (
                <ul className="pos-list pos-list--rows pos-never">
                  {draft.denied.map((p) => (
                    <li key={p} className="pos-list__row">
                      <div className="pos-list__name">
                        <strong>{t(`perm.${p}`)}</strong>
                        <span>{t('staff.never_row_help')}</span>
                      </div>
                      <button
                        type="button"
                        className="pos-btn"
                        aria-label={fill(t('staff.never_remove'), { permission: t(`perm.${p}`) })}
                        onClick={() => update({ denied: draft.denied.filter((d) => d !== p) })}
                      >
                        {t('staff.never_remove_short')}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </Disclosure>

          {stored !== null && (
            <section className="pos-section">
              <div className="pos-row pos-row--apart">
                <div className="pos-section__head">
                  <h2>{t('staff.status')}</h2>
                  <p>{draft.active ? t('staff.status_working') : t('staff.status_left')}</p>
                </div>
                {/* Mark as left lives in the app bar's More menu (hand-off 01b-S02). */}
                {!stored.is_active && !draft.active && (
                  <button type="button" className="pos-btn" onClick={() => update({ active: true })}>
                    {t('staff.bring_back')}
                  </button>
                )}
              </div>
            </section>
          )}
        </div>

        <aside className="pos-card pos-cando">
          <button
            type="button"
            className="pos-cando__toggle"
            aria-expanded={canOpen}
            aria-controls={canOpen ? 'staff-cando' : undefined}
            onClick={() => setCanOpen(!canOpen)}
          >
            <span>{fill(t('staff.can_title'), { name: who })}</span>
            <Icon name="chevron" />
          </button>
          <div className="pos-cando__sum">
            {counts.allowed + counts.approval + counts.never === 0 && <Chip>{t('cando.none')}</Chip>}
            {counts.allowed > 0 && <Chip tone="ok">{fill(t('cando.count_allowed'), { n: String(counts.allowed) })}</Chip>}
            {counts.approval > 0 && <Chip tone="warn">{fill(t('cando.count_approval'), { n: String(counts.approval) })}</Chip>}
            {counts.never > 0 && (
              <Chip tone="danger" icon="x">
                {fill(t('cando.count_never'), { n: String(counts.never) })}
              </Chip>
            )}
          </div>
          {canOpen && (
            <div id="staff-cando" className="pos-cando__body">
              <p className={typeClass('caption')}>{t('staff.can_help')}</p>
              <ul className="pos-can">
                {visible.map((row) => (
                  <li key={row.permission} className={row.changed ? 'is-changed' : ''}>
                    <span>{t(`perm.${row.permission}`)}</span>
                    <GrantChip grant={row.effective.grant} />
                    <small>{canDetail(roles, row.effective)}</small>
                  </li>
                ))}
              </ul>
              <button type="button" className="pos-btn pos-btn--block" onClick={() => setShowAll(!showAll)}>
                {showAll ? t('staff.can_fewer') : fill(t('staff.can_all'), { n: String(rows.length) })}
              </button>
            </div>
          )}
        </aside>
      </div>

      {phone && (
        <div className="pos-staffform__bar">
          <ActionBar>{buttons}</ActionBar>
        </div>
      )}
      {pinOpen && stored !== null && (
        <PinDialog
          api={api}
          staff={stored}
          branchNames={stored.branch_ids.map(name)}
          onSaved={(next) => setStored((prev) => (prev === null ? prev : { ...prev, has_pin: next.has_pin, pin_set_at: next.pin_set_at, version: next.version }))}
          onClose={() => setPinOpen(false)}
        />
      )}
      {leaving && stored !== null && (
        <LeftDialog
          api={api}
          person={stored}
          everyone={loaded.staff}
          branchName={name}
          onDone={(moved) => {
            noteSaved(fill(t('staff.moved'), { name: stored.display_name, n: String(moved) }));
            navigate('/staff');
          }}
          onStale={() => {
            setLeaving(false);
            setStale(true);
          }}
          onClose={() => setLeaving(false)}
        />
      )}
    </Page>
  );
}

function GrantChip({ grant }: { grant: 'allowed' | 'requires_approval' | 'not_granted' | 'denied' }) {
  const tone = grant === 'allowed' ? 'ok' : grant === 'requires_approval' ? 'warn' : grant === 'denied' ? 'danger' : 'info';
  // Frame StaffFormImran: Never carries a lock, Not allowed an ✕.
  const icon = grant === 'denied' ? 'lock' : grant === 'not_granted' ? 'x' : undefined;
  return (
    <Chip tone={tone} icon={icon}>
      {t(`staff.grant.${grant}`)}
    </Chip>
  );
}

// D02: who moves to which lead (B15), then one PATCH `{ expected_version, is_active: false }`.
function LeftDialog({
  api,
  person,
  everyone,
  branchName,
  onDone,
  onStale,
  onClose,
}: {
  api: CloudAdmin;
  person: Staff;
  everyone: readonly Staff[];
  branchName: (id: string) => string;
  onDone: (moved: number) => void;
  onStale: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<{ text: string; detail?: string } | null>(null);
  const [offline, setOffline] = useState(false);
  const byId = new Map(everyone.map((s) => [s.staff_id, s]));
  const moves = person.branch_ids.flatMap((b) => {
    const reports = everyone.filter((s) => s.is_active && s.reports_to.some((r) => r.branch_id === b && r.lead_staff_id === person.staff_id));
    if (reports.length === 0) return [];
    const lead = person.reports_to.find((r) => r.branch_id === b)?.lead_staff_id;
    const names = joinNames(reports.map((s) => s.display_name));
    const leadName = lead === undefined ? null : (byId.get(lead)?.display_name ?? null);
    return [
      leadName === null
        ? fill(t('staff.left_moves_nobody'), { names, branch: branchName(b) })
        : fill(t('staff.left_moves'), { names, branch: branchName(b), lead: leadName }),
    ];
  });

  async function confirm() {
    setBusy(true);
    setOffline(false);
    const result = await api.patchStaff(person.staff_id, { expected_version: person.version, is_active: false });
    setBusy(false);
    if (result.ok) {
      onDone(result.data.moved_reports.length);
      return;
    }
    const error = result.error;
    if (error.kind === 'network') setOffline(true);
    else if (error.kind === 'api' && error.code === 'CONFIG_STALE') onStale();
    else if (error.kind === 'api' && error.code === 'OWN_ADMIN_ACCESS') setBlocked({ text: ownAdminText(error.details) });
    else if (error.kind === 'api' && error.code === 'LAST_ADMIN_REQUIRED') {
      const ids = Array.isArray(error.details['branch_ids']) ? (error.details['branch_ids'] as string[]) : [];
      setBlocked({ text: fill(t('roles.last_admin_body'), { branches: joinNames(ids.map(branchName)) }), detail: t('errors.LAST_ADMIN_REQUIRED') });
    } else setBlocked({ text: errorText(error) ?? '' });
  }

  if (blocked !== null) {
    return (
      <Dialog
        title={fill(t('staff.left_blocked_title'), { name: person.display_name })}
        onClose={onClose}
        footer={
          <button type="button" className="pos-btn pos-btn--primary" onClick={onClose}>
            {t('common.close')}
          </button>
        }
      >
        <Banner tone="danger" text={blocked.text} detail={blocked.detail} />
      </Dialog>
    );
  }

  return (
    <Dialog
      title={fill(t('staff.left_title'), { name: person.display_name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="pos-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="pos-btn pos-btn--primary pos-btn--danger" disabled={busy} onClick={() => void confirm()}>
            {t('staff.mark_left')}
          </button>
        </>
      }
    >
      {offline && <Banner tone="warn" text={t('staff.left_offline')} />}
      <p className="pos-dialog__body">{t('staff.left_body')}</p>
      {moves.length > 0 && (
        <div className="pos-explain">
          <span>{moves.join(' ')}</span>
        </div>
      )}
    </Dialog>
  );
}
