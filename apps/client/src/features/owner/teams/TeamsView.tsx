import { useEffect, useMemo, useState } from 'react';
import { usePhone } from '../../../app/phone';
import type { CloudAdmin, Role, TeamNode } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { Chip } from '../../../components/Chip';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { language, t, typeClass } from '../../../i18n';
import { useBranchName } from '../branch';
import { useCloudDown } from '../cloud';
import { errorText } from '../form';
import { BranchSelect, Page, PeopleTabs } from '../Shell';
import { roleNames } from '../staff/people';

// 01b §8 #/teams (01b-S10, §6.12): the branch's leads and their members as an indented, read-only list
// (name, role names, "No PIN" when `has_pin` is false); each name opens #/staff/:id, where lines are
// edited. While the cloud is down the last loaded tree stays, with the time it was read.
// Pulse (hand-off 01b-S10): each row ends in a chevron; on a phone the branch select sits in the content,
// the intro is left out and the foot is the phone hint (TeamsPhone).
function size(node: TeamNode): number {
  return node.members.reduce((n, m) => n + 1 + size(m), 0);
}

export function TeamsView({
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
  const [tree, setTree] = useState<{ branchId: string; roots: TeamNode[]; at: number } | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState<string | null>(null);
  const down = useCloudDown(api);
  const branchName = useBranchName();
  const branch = branchName(branchId);
  const phone = usePhone();

  useEffect(() => {
    let live = true;
    void Promise.all([api.getTeamTree(branchId), api.listRoles()]).then(([teams, list]) => {
      if (!live) return;
      if (list.ok) setRoles(list.data.roles);
      if (teams.ok) {
        setTree({ branchId, roots: teams.data.roots, at: Date.now() });
        setError(null);
      } else {
        setError(errorText(teams.error));
      }
    });
    return () => {
      live = false;
    };
  }, [api, branchId]);

  const byId = useMemo(() => new Map(roles.map((r) => [r.role_id, r])), [roles]);
  const shown = tree !== null && tree.branchId === branchId ? tree : null;
  const time = shown === null ? '' : new Intl.DateTimeFormat(language() === 'ur' ? 'ur-PK' : 'en-GB', { hour: 'numeric', minute: '2-digit' }).format(shown.at);

  function node(n: TeamNode, top: boolean) {
    const count = size(n);
    return (
      <li key={n.staff_id}>
        <a className="pos-tree__node" href={`#/staff/${encodeURIComponent(n.staff_id)}`}>
          <div className="pos-list__name">
            <strong>{n.display_name}</strong>
            <span>{roleNames(byId, n.role_ids).join(' · ')}</span>
          </div>
          {count > 0 && (
            <span className="pos-tree__count">
              {top ? fill(t('teams.count_team'), { n: String(count) }) : count === 1 ? t('teams.count_one') : fill(t('teams.count'), { n: String(count) })}
            </span>
          )}
          {!n.has_pin && (
            <Chip tone="warn" icon="alert">
              {t('teams.no_pin')}
            </Chip>
          )}
          <Icon name="forward" flip />
        </a>
        {n.members.length > 0 && <ul>{n.members.map((m) => node(m, false))}</ul>}
      </li>
    );
  }

  const select = <BranchSelect branchIds={branchIds} value={branchId} onChange={onBranch} />;
  return (
    <Page api={api} title={t('teams.title')} end={phone ? undefined : select}>
      <PeopleTabs current="teams" />
      {phone && <div className="pos-branchpick">{select}</div>}
      {down && shown !== null && <p className={`${typeClass('caption')} pos-intro`}>{fill(t('teams.loaded_at'), { time })}</p>}
      {error !== null && <Banner tone="danger" text={error} />}
      {!phone && <p className={`${typeClass('body')} pos-intro`}>{fill(t('teams.intro'), { branch })}</p>}
      {shown === null ? (
        error === null && <Skeleton lines={6} />
      ) : shown.roots.length === 0 ? (
        <EmptyState card icon="team" title={fill(t('teams.empty'), { branch })} body={fill(t('teams.empty_body'), { branch })} />
      ) : (
        <>
          {shown.roots.every((r) => r.members.length === 0) && (
            <div className="pos-explain">
              <Icon name="team" />
              <span>{t('teams.flat')}</span>
            </div>
          )}
          <ul className="pos-tree">{shown.roots.map((r) => node(r, true))}</ul>
        </>
      )}
      <p className={`${typeClass('caption')} pos-intro`}>{t(phone ? 'teams.phone_hint' : 'teams.foot')}</p>
    </Page>
  );
}
