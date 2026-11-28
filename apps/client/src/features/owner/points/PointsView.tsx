import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CloudAdmin, CloudError, Point } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { ConfirmDialog, Dialog } from '../../../components/Dialog';
import { EmptyState } from '../../../components/EmptyState';
import { SavedChip, useFlash } from '../../../components/FlashChip';
import { Icon } from '../../../components/Icon';
import { MoreMenu } from '../../../components/MoreMenu';
import { Skeleton } from '../../../components/Skeleton';
import { StaleBanner } from '../../../components/StaleBanner';
import { fill } from '../../../i18n/en';
import { t, type MessageKey } from '../../../i18n';
import { useCloudDown } from '../cloud';
import { errorText, isKeyMismatch, issueMessages, useIdempotencyKey } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { BranchSelect, Page } from '../Shell';
import { pointWarnings, type PointWarning } from './warnings';

// §8.1 #/points (03a D1, A-1; 01a §6.9a): the branch's points (where food is handed over), with add, edit (name,
// position, Receives), reorder (a sort number, no drag) and archive/restore. 01a v2.11 PT-4 (run 3 R3-m-1): Receives
// is "All order types" or Dine-in / Takeaway / Parking; a stored Delivery stays as a read-only chip and counts toward
// the set; order_types is sent only when it changed. D7 (R3-B-1): archiving moves the point's waiting work to the
// Pass that takes it now; with no other active Pass the cloud refuses with 400 VALIDATION_FAILED on path
// `archived`, shown as "Activate another Pass point first". A stale save (409 CONFIG_STALE) keeps the form and
// shows "changed elsewhere" with Reload (01c-B03).
const INT_RE = /^-?[0-9]+$/;
const active = (point: Point) => point.archived_at === null;

type Receives = Point['order_types'];
type OrderType = Exclude<Receives, 'all'>[number];
// Delivery is not selectable until delivery orders ship (PT-4); a stored one is kept as a chip.
const SELECTABLE: readonly OrderType[] = ['dine_in', 'takeaway', 'parking'];
const SHOWN: readonly OrderType[] = ['dine_in', 'takeaway', 'parking', 'delivery'];
const TYPE_LABEL: Record<OrderType, MessageKey> = {
  dine_in: 'owner.points.type.dine_in',
  takeaway: 'owner.points.type.takeaway',
  parking: 'owner.points.type.parking',
  delivery: 'owner.points.type.delivery',
};
// The cloud stores an explicit set sorted (01a v2.11 PT-2); sending it the same way keeps the compare exact.
const canonical = (types: readonly OrderType[]): OrderType[] => [...types].sort();
const sameReceives = (a: Receives, b: Receives) => (a === 'all' || b === 'all' ? a === b : canonical(a).join() === canonical(b).join());

// ⚠️ 01a v2.12 QS-1 (BUG-8): a warning above the list in plain words
function warningText(w: PointWarning): string {
  const names = (list: string[]) => list.join(', ');
  if (w.kind === 'same_position') return fill(t('owner.points.warn.same_position'), { names: names(w.names), n: String(w.sort_order) });
  if (w.kind === 'tie') return fill(t('owner.points.warn.tie'), { type: t(TYPE_LABEL[w.order_type]), count: String(w.names.length), names: names(w.names) });
  return fill(t('owner.points.warn.gap'), { type: t(TYPE_LABEL[w.order_type]) });
}

function receivesText(receives: Receives): string {
  if (receives === 'all') return t('owner.points.receives_all');
  return SHOWN.filter((type) => receives.includes(type))
    .map((type) => t(TYPE_LABEL[type]))
    .join(', ');
}

// D7: the cloud's archive refusal (no other active Pass) is a validation issue on `archived`.
function archiveRefused(error: CloudError): boolean {
  if (error.kind !== 'api' || error.code !== 'VALIDATION_FAILED') return false;
  const issues = error.details['issues'];
  return Array.isArray(issues) && issues.some((issue: { path?: unknown }) => issue.path === 'archived');
}

function PointDialog({
  api,
  branchId,
  point,
  onSaved,
  onReload,
  onClose,
}: {
  api: CloudAdmin;
  branchId: string;
  point: Point | null;
  onSaved: () => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const { key, renew } = useIdempotencyKey();
  const [name, setName] = useState(point?.name ?? '');
  const [sort, setSort] = useState(point === null ? '' : String(point.sort_order));
  const stored: Receives = point?.order_types ?? 'all';
  const [all, setAll] = useState(stored === 'all');
  const [types, setTypes] = useState<OrderType[]>(stored === 'all' ? [] : stored.filter((type) => SELECTABLE.includes(type)));
  const kept = stored === 'all' ? [] : stored.filter((type) => !SELECTABLE.includes(type));
  const receives: Receives = all ? 'all' : canonical([...kept, ...types]);
  const noType = receives !== 'all' && receives.length === 0;
  const routingChanged = !sameReceives(receives, stored);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const down = useCloudDown(api);
  const leave = useLeave();
  const sortValue = sort.trim() === '' ? (point === null ? undefined : null) : INT_RE.test(sort.trim()) ? Number(sort.trim()) : null;
  const touched =
    routingChanged || (point === null ? name !== '' || sort !== '' : name.trim() !== point.name || sort.trim() !== String(point.sort_order));
  useDirtyForm(
    touched
      ? { name: point?.name ?? t('owner.points.new_title'), fields: [t('owner.points.name').toLowerCase(), t('owner.points.receives').toLowerCase()] }
      : null,
  );
  const receivesIssue = Object.entries(issues).find(([path]) => path === 'order_types' || path.startsWith('order_types.'))?.[1];

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || stale || noType) return;
    if (name.trim() === '' || sortValue === null) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    const patch =
      point === null
        ? null
        : {
            ...(name.trim() !== point.name ? { name: name.trim() } : {}),
            ...(sortValue !== undefined && sortValue !== point.sort_order ? { sort_order: sortValue } : {}),
            // PATCH omission keeps the stored set (PT-2): sent only when Receives changed
            ...(routingChanged ? { order_types: receives } : {}),
          };
    // PatchPointBody refuses a body with only expected_version: nothing changed, nothing sent.
    if (patch !== null && Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    setIssues({});
    const result =
      point === null
        ? await api.createPoint(
            branchId,
            { name: name.trim(), ...(sortValue === undefined ? {} : { sort_order: sortValue }), ...(receives === 'all' ? {} : { order_types: receives }) },
            key,
          )
        : await api.patchPoint(branchId, point.point_id, { expected_version: point.version, ...patch });
    setBusy(false);
    if (result.ok) {
      renew();
      onSaved();
      return;
    }
    if (result.error.kind === 'api' && result.error.code === 'CONFIG_STALE') {
      setStale(true);
      return;
    }
    setIssues(issueMessages(result.error));
    setError(errorText(result.error));
    if (isKeyMismatch(result.error)) {
      renew();
      onReload();
    }
  }

  return (
    <Dialog title={t(point === null ? 'owner.points.new_title' : 'owner.points.edit_title')} onClose={() => leave(onClose)} form>
      <form className="pos-stack" data-form="point" noValidate onSubmit={(e) => void submit(e)}>
        {point === null && <p className="pos-dialog__body">{t('owner.points.new_body')}</p>}
        <label className={`pos-field${issues['name'] !== undefined ? ' pos-field--error' : ''}`}>
          <span className="pos-field__label">{t('owner.points.name')}</span>
          <input className="pos-input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
          {issues['name'] !== undefined && <span className="pos-field__help">{issues['name']}</span>}
        </label>
        <label className={`pos-field${issues['sort_order'] !== undefined ? ' pos-field--error' : ''}`}>
          <span className="pos-field__label">{t('owner.points.sort')}</span>
          <input className="pos-input pos-input--mono" name="sort_order" inputMode="numeric" value={sort} onChange={(e) => setSort(e.target.value)} />
          {issues['sort_order'] !== undefined && <span className="pos-field__help">{issues['sort_order']}</span>}
        </label>
        <div className={`pos-field${receivesIssue !== undefined ? ' pos-field--error' : ''}`} data-receives role="group" aria-label={t('owner.points.receives')}>
          <span className="pos-field__label">{t('owner.points.receives')}</span>
          <div className="pos-row">
            <button type="button" role="checkbox" aria-checked={all} data-receives-all className={`pos-tick${all ? ' is-on' : ''}`} onClick={() => setAll(!all)}>
              <i />
              {t('owner.points.receives_all')}
            </button>
            {!all &&
              SELECTABLE.map((type) => (
                <button
                  key={type}
                  type="button"
                  role="checkbox"
                  aria-checked={types.includes(type)}
                  data-receives-type={type}
                  className={`pos-tick${types.includes(type) ? ' is-on' : ''}`}
                  onClick={() => setTypes(types.includes(type) ? types.filter((x) => x !== type) : [...types, type])}
                >
                  <i />
                  {t(TYPE_LABEL[type])}
                </button>
              ))}
            {!all &&
              kept.map((type) => (
                <span key={type} className="pos-chip" data-readonly-type={type} title={t('owner.points.delivery_readonly')}>
                  {t(TYPE_LABEL[type])}
                </span>
              ))}
          </div>
          <span className="pos-field__help">{receivesIssue ?? t('owner.points.receives_help')}</span>
          {!all && kept.length > 0 && <span className="pos-field__help">{t('owner.points.delivery_readonly')}</span>}
        </div>
        {stale && <StaleBanner onReload={onReload} />}
        {error !== null && <Banner tone="danger" text={error} />}
        <div className="pos-dialog__footer">
          <button type="button" className="pos-btn" onClick={() => leave(onClose)}>
            {t('common.cancel')}
          </button>
          <BusyButton busy={busy} primary disabled={down || stale || noType} type="submit">
            {t(point === null ? 'owner.points.add' : 'owner.points.save')}
          </BusyButton>
        </div>
      </form>
    </Dialog>
  );
}

type Ask =
  | { kind: 'add' }
  | { kind: 'edit'; point: Point }
  | { kind: 'archive'; point: Point }
  | null;

export function PointsView({
  api,
  branchId,
  branchIds = [branchId],
  onBranch = () => {},
}: {
  api: CloudAdmin;
  branchId: string;
  branchIds?: readonly string[];
  onBranch?: (branchId: string) => void;
}) {
  const [points, setPoints] = useState<Point[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const saved = useFlash();
  const down = useCloudDown(api);

  // `keepError`: a refused write reloads the list but leaves its message showing.
  const load = useCallback(async (keepError = false) => {
    const result = await api.listStations(branchId);
    if (result.ok) {
      setPoints(result.data.points);
      setStale(false);
      if (!keepError) setError(null);
    } else setError(errorText(result.error));
  }, [api, branchId]);

  useEffect(() => {
    setPoints(null);
    void load();
  }, [load]);

  const wasDown = useRef(down);
  useEffect(() => {
    if (wasDown.current && !down && points === null) void load();
    wasDown.current = down;
  }, [down, points, load]);

  function flashSaved(id: string | null) {
    setSavedId(id);
    saved.flash();
  }

  async function setArchived(point: Point, archived: boolean) {
    setAsk(null);
    const result = await api.patchPoint(branchId, point.point_id, { expected_version: point.version, archived });
    if (result.ok) {
      flashSaved(point.point_id);
      await load();
      return;
    }
    const error = result.error;
    if (error.kind === 'api' && error.code === 'CONFIG_STALE') {
      setStale(true);
      return;
    }
    setError(archiveRefused(error) ? t('owner.points.archive_refused') : errorText(error));
    await load(true);
  }

  // BUG-26 (01a v2.11 §6.9a D7): the cloud refuses an archive that leaves the branch no other active point; the page
  // knows the list, so the last active point is refused here, before the confirm (the cloud check stays the authority)
  function askArchive(point: Point) {
    if (!(points ?? []).some((other) => other.point_id !== point.point_id && active(other))) {
      setError(t('owner.points.archive_refused'));
      return;
    }
    setError(null);
    setAsk({ kind: 'archive', point });
  }

  const visible = (points ?? []).filter((point) => showArchived || active(point));

  return (
    <Page
      api={api}
      title={t('owner.points.title')}
      after={<BranchSelect branchIds={branchIds} value={branchId} onChange={onBranch} />}
      end={
        <>
          <MoreMenu
            label={t('owner.points.more')}
            items={[
              {
                label: t(showArchived ? 'owner.points.hide_archived' : 'owner.common.show_archived'),
                icon: 'archive',
                onSelect: () => setShowArchived(!showArchived),
              },
            ]}
          />
          <button type="button" className="pos-btn pos-btn--primary" disabled={down || stale} onClick={() => setAsk({ kind: 'add' })}>
            <Icon name="plus" />
            {t('owner.points.add')}
          </button>
        </>
      }
    >
      {error !== null && <Banner tone="danger" text={error} />}
      {stale && <StaleBanner onReload={() => void load()} />}
      {points === null && <Skeleton lines={3} />}
      {points !== null && <p className="pos-dialog__body">{t('owner.points.intro')}</p>}
      {points !== null &&
        pointWarnings(points).map((w) => (
          <div key={`${w.kind}:${'order_type' in w ? w.order_type : w.sort_order}`} data-point-warning={w.kind}>
            <Banner tone="warn" text={warningText(w)} />
          </div>
        ))}
      {points !== null && visible.length === 0 && <EmptyState title={t('owner.points.empty')} body={t('owner.points.empty_body')} />}
      {points !== null && visible.length > 0 && (
        <ul className="pos-list pos-list--points">
          {visible.map((point) => (
            <li key={point.point_id} className={`pos-list__row${active(point) ? '' : ' is-muted'}`} data-point-id={point.point_id}>
              <span className="pos-list__name">
                <strong>{point.name}</strong>
                <span>{fill(t('owner.points.position_n'), { n: String(point.sort_order) })}</span>
                <span>{fill(t('owner.points.receives_n'), { types: receivesText(point.order_types) })}</span>
              </span>
              <div className="pos-section__tools">
                <SavedChip shown={saved.shown && savedId === point.point_id} />
                {active(point) ? (
                  <>
                    <button type="button" className="pos-btn" disabled={down} onClick={() => setAsk({ kind: 'edit', point })}>
                      {t('owner.points.edit')}
                    </button>
                    <button type="button" className="pos-btn" disabled={down || stale} onClick={() => askArchive(point)}>
                      {t('owner.common.archive')}
                    </button>
                  </>
                ) : (
                  <button type="button" className="pos-btn" disabled={down || stale} onClick={() => void setArchived(point, false)}>
                    {t('owner.common.restore')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {(ask?.kind === 'add' || ask?.kind === 'edit') && (
        <PointDialog
          api={api}
          branchId={branchId}
          point={ask.kind === 'edit' ? ask.point : null}
          onClose={() => setAsk(null)}
          onReload={() => {
            setAsk(null);
            void load();
          }}
          onSaved={() => {
            flashSaved(ask.kind === 'edit' ? ask.point.point_id : null);
            setAsk(null);
            void load();
          }}
        />
      )}
      {ask?.kind === 'archive' && (
        <ConfirmDialog
          title={fill(t('archive.item_title'), { name: ask.point.name })}
          body={t('owner.points.archive_moves_body')}
          confirmLabel={fill(t('archive.archive_name'), { name: ask.point.name })}
          tone="danger"
          onConfirm={() => void setArchived(ask.point, true)}
          onCancel={() => setAsk(null)}
        />
      )}
    </Page>
  );
}
