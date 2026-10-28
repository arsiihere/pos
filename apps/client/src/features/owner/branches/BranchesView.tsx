import { useCallback, useEffect, useState } from 'react';
import type { Branch, CloudAdmin } from '../../../api/cloud-admin';
import { navigate } from '../../../app/router';
import { Banner } from '../../../components/Banner';
import { Chip } from '../../../components/Chip';
import { Dialog } from '../../../components/Dialog';
import { ListRow } from '../../../components/List';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { t, typeClass } from '../../../i18n';
import { idTail } from '../branch';
import { useCloudDown } from '../cloud';
import { errorText } from '../form';
import { Page } from '../Shell';

// 01b §8 #/branches (01b-S06, D04, B19): each branch with "Hub checked {time}" and "Up to date {time}";
// the second warns when `hub_last_seen_at − hub_synced_at > hub_stale_after_ms`, the threshold the list
// response carries (D-11: no constant here). A hub that stopped checking in for longer than the same
// threshold shows the away notice (AD-32). Rename is D04 (§6.9); Settings opens #/branches/:id/settings.
export function ago(ms: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - ms) / 60_000);
  if (minutes < 1) return t('branches.ago_now');
  if (minutes < 60) return fill(t('branches.ago_min'), { n: String(minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return fill(t('branches.ago_h'), { n: String(hours) });
  return fill(t('branches.ago_days'), { n: String(Math.floor(hours / 24)) });
}

export function BranchesView({ api }: { api: CloudAdmin }) {
  const [list, setList] = useState<{ branches: Branch[]; staleAfter: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Branch | null>(null);
  const [renamed, setRenamed] = useState<string | null>(null);
  const down = useCloudDown(api);

  const load = useCallback(async () => {
    const result = await api.listBranches();
    if (result.ok) {
      setList({ branches: result.data.branches, staleAfter: result.data.hub_stale_after_ms });
      setError(null);
    } else {
      setError(errorText(result.error));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const now = Date.now();

  return (
    <Page api={api} title={t('branches.title')}>
      {error !== null && <Banner tone="danger" text={error} />}
      {renamed !== null && <Banner tone="ok" text={fill(t('branches.renamed'), { name: renamed })} detail={t('branches.renamed_body')} />}
      {list === null ? (
        error === null && <Skeleton lines={3} />
      ) : (
        <ul className="pos-list pos-list--rows">
          {list.branches.map((b) => {
            const pending = b.status === 'pending_hub' || b.hub_last_seen_at === null;
            const behind =
              !pending && (b.hub_synced_at === null || (b.hub_last_seen_at ?? 0) - b.hub_synced_at > list.staleAfter);
            const away = !pending && now - (b.hub_last_seen_at ?? now) > list.staleAfter;
            return (
              <ListRow key={b.branch_id}>
                <div className="pos-list__name">
                  <strong>
                    {b.name}
                    {b.status === 'active' ? <Chip tone="ok">{t('branches.open')}</Chip> : <Chip tone="info">{t('branches.not_open')}</Chip>}
                  </strong>
                  <span>
                    <span className="pos-ltr">{idTail(b.branch_id)}</span>
                  </span>
                  {pending ? (
                    <div className="pos-hub">
                      <span>{t('branches.no_hub')}</span>
                    </div>
                  ) : away ? (
                    <div className="pos-hub is-warn">
                      <div>
                        <b>{fill(t('branches.away'), { branch: b.name, seen: ago(b.hub_last_seen_at ?? now, now) })}</b>
                        <span>{t('branches.away_body')}</span>
                      </div>
                    </div>
                  ) : behind ? (
                    <div className="pos-hub is-warn">
                      <div>
                        <b>
                          {b.hub_synced_at === null
                            ? t('branches.never_synced')
                            : fill(t('branches.behind'), { synced: ago(b.hub_synced_at, now) })}
                        </b>
                        <span>{t('branches.behind_body')}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="pos-hub">
                      <span>
                        {fill(t('branches.hub_ok'), {
                          seen: ago(b.hub_last_seen_at ?? now, now),
                          synced: ago(b.hub_synced_at ?? now, now),
                        })}
                      </span>
                    </div>
                  )}
                </div>
                <div className="pos-list__side">
                  <button type="button" className="pos-btn" disabled={down} onClick={() => setRenaming(b)}>
                    {t('branches.rename')}
                  </button>
                  <button type="button" className="pos-btn" onClick={() => navigate(`/branches/${encodeURIComponent(b.branch_id)}/settings`)}>
                    {t('branches.settings')}
                  </button>
                </div>
              </ListRow>
            );
          })}
        </ul>
      )}
      <p className={typeClass('caption')}>{t('branches.foot')}</p>
      {renaming !== null && (
        <RenameDialog
          api={api}
          branch={renaming}
          onDone={(next) => {
            setList((prev) =>
              prev === null ? prev : { ...prev, branches: prev.branches.map((b) => (b.branch_id === next.branch_id ? { ...b, name: next.name } : b)) },
            );
            setRenamed(next.name);
            setRenaming(null);
          }}
          onClose={() => setRenaming(null)}
        />
      )}
    </Page>
  );
}

function RenameDialog({
  api,
  branch,
  onDone,
  onClose,
}: {
  api: CloudAdmin;
  branch: Branch;
  onDone: (branch: { branch_id: string; name: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(branch.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > 60) {
      setError(t('branches.name_required'));
      return;
    }
    if (trimmed === branch.name) {
      onClose();
      return;
    }
    setBusy(true);
    const result = await api.renameBranch(branch.branch_id, { name: trimmed });
    setBusy(false);
    if (result.ok) {
      onDone(result.data.branch);
      return;
    }
    const taken = result.error.kind === 'api' && result.error.code === 'CONFIG_NAME_TAKEN';
    setError(taken ? fill(t('branches.name_taken'), { name: trimmed }) : errorText(result.error));
  }

  return (
    <Dialog
      title={fill(t('branches.rename_title'), { name: branch.name })}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="pos-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="pos-btn pos-btn--primary" disabled={busy} onClick={() => void save()}>
            {t('branches.rename')}
          </button>
        </>
      }
    >
      <label className={`pos-field${error !== null ? ' pos-field--error' : ''}`}>
        <span className="pos-field__label">{t('branches.name')}</span>
        <input className="pos-input" name="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        {error !== null ? <span className="pos-field__error">{error}</span> : <span className="pos-field__help">{t('branches.name_help')}</span>}
      </label>
      <div className="pos-explain">
        <span>{t('branches.rename_note')}</span>
      </div>
    </Dialog>
  );
}
