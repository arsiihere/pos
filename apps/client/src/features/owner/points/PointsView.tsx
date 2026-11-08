import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CloudAdmin, Point } from '../../../api/cloud-admin';
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
import { t } from '../../../i18n';
import { navigate } from '../../../app/router';
import { BlockedDialog, usedIds, type InUse } from '../BlockedDialog';
import { useCloudDown } from '../cloud';
import { errorText, isKeyMismatch, issueMessages, useIdempotencyKey } from '../form';
import { useDirtyForm, useLeave } from '../guard';
import { BranchSelect, Page } from '../Shell';

// §8.1 #/points (03a D1, A-1; 01a §6.9a): the branch's points (where food is handed over), with add, rename,
// reorder (a sort number, no drag) and archive/restore. A point a station still names cannot be archived: the
// 409 CONFIG_IN_USE answer lists those stations by name. A stale save (409 CONFIG_STALE) keeps the form and
// shows "changed elsewhere" with Reload (01c-B03).
const INT_RE = /^-?[0-9]+$/;
const active = (point: Point) => point.archived_at === null;

type StationName = { station_id: string; name: string };

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
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const down = useCloudDown(api);
  const leave = useLeave();
  const sortValue = sort.trim() === '' ? (point === null ? undefined : null) : INT_RE.test(sort.trim()) ? Number(sort.trim()) : null;
  const touched = point === null ? name !== '' || sort !== '' : name.trim() !== point.name || sort.trim() !== String(point.sort_order);
  useDirtyForm(touched ? { name: point?.name ?? t('owner.points.new_title'), fields: [t('owner.points.name').toLowerCase()] } : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || stale) return;
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
        ? await api.createPoint(branchId, { name: name.trim(), ...(sortValue === undefined ? {} : { sort_order: sortValue }) }, key)
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
    <Dialog title={t(point === null ? 'owner.points.new_title' : 'owner.points.rename_title')} onClose={() => leave(onClose)} form>
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
        {stale && <StaleBanner onReload={onReload} />}
        {error !== null && <Banner tone="danger" text={error} />}
        <div className="pos-dialog__footer">
          <button type="button" className="pos-btn" onClick={() => leave(onClose)}>
            {t('common.cancel')}
          </button>
          <BusyButton busy={busy} primary disabled={down || stale} type="submit">
            {t(point === null ? 'owner.points.add' : 'owner.points.save')}
          </BusyButton>
        </div>
      </form>
    </Dialog>
  );
}

type Ask =
  | { kind: 'add' }
  | { kind: 'rename'; point: Point }
  | { kind: 'archive'; point: Point }
  | { kind: 'blocked'; point: Point; inUse: InUse }
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
  const [stations, setStations] = useState<StationName[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const saved = useFlash();
  const down = useCloudDown(api);
  const leave = useLeave();

  // `keepError`: a refused write reloads the list but leaves its message showing.
  const load = useCallback(async (keepError = false) => {
    const result = await api.listStations(branchId);
    if (result.ok) {
      setPoints(result.data.points);
      setStations(result.data.stations);
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
    const ids = usedIds(error);
    if (ids !== null) {
      const names = ids.flatMap((id) => stations.find((s) => s.station_id === id)?.name ?? []);
      setAsk({ kind: 'blocked', point, inUse: { ids, names } });
    } else setError(errorText(error));
    await load(true);
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
      {points !== null && visible.length === 0 && <EmptyState title={t('owner.points.empty')} body={t('owner.points.empty_body')} />}
      {points !== null && visible.length > 0 && (
        <ul className="pos-list pos-list--points">
          {visible.map((point) => (
            <li key={point.point_id} className={`pos-list__row${active(point) ? '' : ' is-muted'}`} data-point-id={point.point_id}>
              <span className="pos-list__name">
                <strong>{point.name}</strong>
                <span>{fill(t('owner.points.position_n'), { n: String(point.sort_order) })}</span>
              </span>
              <div className="pos-section__tools">
                <SavedChip shown={saved.shown && savedId === point.point_id} />
                {active(point) ? (
                  <>
                    <button type="button" className="pos-btn" disabled={down} onClick={() => setAsk({ kind: 'rename', point })}>
                      {t('owner.points.rename')}
                    </button>
                    <button type="button" className="pos-btn" disabled={down || stale} onClick={() => setAsk({ kind: 'archive', point })}>
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

      {(ask?.kind === 'add' || ask?.kind === 'rename') && (
        <PointDialog
          api={api}
          branchId={branchId}
          point={ask.kind === 'rename' ? ask.point : null}
          onClose={() => setAsk(null)}
          onReload={() => {
            setAsk(null);
            void load();
          }}
          onSaved={() => {
            flashSaved(ask.kind === 'rename' ? ask.point.point_id : null);
            setAsk(null);
            void load();
          }}
        />
      )}
      {ask?.kind === 'archive' && (
        <ConfirmDialog
          title={fill(t('archive.item_title'), { name: ask.point.name })}
          body={t('owner.points.archive_body')}
          confirmLabel={fill(t('archive.archive_name'), { name: ask.point.name })}
          tone="danger"
          onConfirm={() => void setArchived(ask.point, true)}
          onCancel={() => setAsk(null)}
        />
      )}
      {ask?.kind === 'blocked' && (
        <BlockedDialog
          title={fill(t('archive.blocked_title'), { name: ask.point.name })}
          body={fill(t('owner.points.blocked_body'), {
            name: ask.point.name,
            n: String(ask.inUse.ids.length),
            names: ask.inUse.names.join(', '),
          })}
          inUse={ask.inUse}
          onClose={() => setAsk(null)}
          action={
            <button type="button" className="pos-btn pos-btn--primary" onClick={() => leave(() => navigate('/stations'))}>
              {t('owner.points.open_stations')}
            </button>
          }
        />
      )}
    </Page>
  );
}
