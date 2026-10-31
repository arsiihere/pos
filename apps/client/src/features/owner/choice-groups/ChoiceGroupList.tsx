import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CloudAdmin, ModifierGroup } from '../../../api/cloud-admin';
import { usePhone } from '../../../app/phone';
import { Banner } from '../../../components/Banner';
import { Icon } from '../../../components/Icon';
import { MoreMenu } from '../../../components/MoreMenu';
import { Skeleton } from '../../../components/Skeleton';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { useBranchName } from '../branch';
import { bySortThenName, ListBar, ListEmpty } from '../c01';
import { errorText } from '../form';
import { Page } from '../Shell';
import { appliesText, nothingOffered, omittedAt, optionsText, pickText } from './choice';
import { MenuRetry, useMenuPages } from './useMenuPages';

// 01c-S02 (§8 "Views", §6.10; Q12): choice groups (archived ones behind ⋯ "Show archived"), searched by name,
// sorted by sort_order then name. Columns Choice group (Required / Optional + branch warning chips) · Customers
// pick · Options (first 3 + "+N") · Applies to. 01c-B04 "Not offered at X" chips appear only after the last
// menu page has loaded (m11, N9; "Checking branches…" until then); 01c-B05 chips need no menu.
export function ChoiceGroupList({ api }: { api: CloudAdmin }) {
  const [list, setList] = useState<{
    canEdit: boolean;
    groups: ModifierGroup[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { menu, done: checked, error: menuError, retry } = useMenuPages(api);
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const phone = usePhone();
  const branchName = useBranchName();

  const load = useCallback(async () => {
    const result = await api.listModifierGroups(archived ? { status: 'archived' } : {});
    if (result.ok) {
      setList({
        canEdit: result.data.can_edit_tenant,
        groups: result.data.modifier_groups,
      });
      setError(null);
    } else setError(errorText(result.error));
  }, [api, archived]);

  useEffect(() => {
    void load();
  }, [load]);

  const items = useMemo(() => new Map((menu?.items ?? []).map((item) => [item.item_id, item])), [menu]);
  const needle = search.trim().toLowerCase();
  const groups = (list?.groups ?? []).filter((g) => needle === '' || g.name.toLowerCase().includes(needle)).sort(bySortThenName);
  const canEdit = list?.canEdit === true;
  const href = (group: ModifierGroup) => `#/choice-groups/${encodeURIComponent(group.modifier_group_id)}`;

  const warnings = (group: ModifierGroup) => {
    const out: string[] = [];
    for (const branch of group.branches) {
      if (checked && omittedAt(group, branch, items))
        out.push(
          fill(t('choice_groups.omitted'), {
            branch: branchName(branch.branch_id),
          }),
        );
      if (nothingOffered(group, branch))
        out.push(
          fill(t('choice_groups.nothing_at'), {
            branch: branchName(branch.branch_id),
          }),
        );
    }
    return out.length === 0 ? null : (
      <div className="pos-chips">
        {out.map((text) => (
          <span key={text} className="pos-chip pos-chip--warn">
            <Icon name="alert" />
            {text}
          </span>
        ))}
      </div>
    );
  };

  const newButton = (label: string) =>
    canEdit && (
      <a className="pos-btn pos-btn--primary" href="#/choice-groups/new">
        <Icon name="plus" />
        {label}
      </a>
    );
  const end = (
    <>
      {!phone && (
        <MoreMenu
          label={t('choice_groups.more')}
          items={[
            {
              label: archived ? t('choice_groups.hide_archived') : t('choice_groups.show_archived'),
              icon: 'archive',
              onSelect: () => setArchived(!archived),
            },
          ]}
        />
      )}
      {newButton(phone ? t('c01.new_short') : t('choice_groups.new'))}
    </>
  );
  const status = (group: ModifierGroup) => (group.min_choices >= 1 ? t('choice_groups.required') : t('choice_groups.optional'));

  let body;
  if (list === null) body = error !== null ? <Banner tone="danger" text={error} /> : <Skeleton lines={6} />;
  else if (!archived && list.groups.length === 0)
    body = (
      <ListEmpty icon="sliders" title={t('choice_groups.empty_title')} body={t('choice_groups.empty_body')}>
        {newButton(t('choice_groups.new'))}
      </ListEmpty>
    );
  else
    body = (
      <>
        <div className="pos-cgbar">
          <ListBar
            search={search}
            onSearch={setSearch}
            placeholder={t('choice_groups.search')}
            archived={archived}
            onHideArchived={() => setArchived(false)}
            hideArchivedLabel={t('choice_groups.hide_archived')}
            helper={checked ? t('choice_groups.helper') : ''}
          />
          {!checked && menuError === null && (
            <span className="pos-progress-line pos-cgbar__checking" role="status" data-checking="">
              <span className="pos-spin" />
              {t('choice_groups.checking')}
            </span>
          )}
        </div>
        {error !== null && <Banner tone="danger" text={error} />}
        {menuError !== null && <MenuRetry error={menuError} onRetry={retry} />}
        {groups.length === 0 ? (
          <ListEmpty icon="search" title={needle === '' ? t('c01.none_archived') : fill(t('c01.no_match'), { q: search.trim() })} />
        ) : phone ? (
          <div className="pos-c01cards">
            {groups.map((group) => (
              <a key={group.modifier_group_id} className="pos-pcard pos-c01card" href={href(group)} data-group-id={group.modifier_group_id}>
                <div className="pos-pcard__top">
                  <div>
                    <strong>{group.name}</strong>
                    <span className="sub">{`${pickText(group)} · ${optionsText(group)}`}</span>
                    <span className="sub">{appliesText(menu, group.links)}</span>
                  </div>
                  <Icon name="forward" flip />
                </div>
                {warnings(group)}
              </a>
            ))}
          </div>
        ) : (
          <ul className="pos-list pos-list--c5 pos-list--open pos-list--cg">
            <li className="pos-list__head">
              <span>{t('choice_groups.col_name')}</span>
              <span>{t('choice_groups.col_pick')}</span>
              <span>{t('choice_groups.col_options')}</span>
              <span>{t('choice_groups.col_applies')}</span>
              <span />
            </li>
            {groups.map((group) => (
              <li
                key={group.modifier_group_id}
                className={`pos-list__row${group.archived_at !== null ? ' is-archived' : ''}`}
                data-group-id={group.modifier_group_id}
              >
                <div className="pos-list__name">
                  <strong>{group.name}</strong>
                  <span>{status(group)}</span>
                  {warnings(group)}
                </div>
                <span className="pos-list__muted pos-cgpick">{pickText(group)}</span>
                <span className="pos-list__muted">{optionsText(group)}</span>
                <span className="pos-list__muted">{appliesText(menu, group.links)}</span>
                <a className="pos-rowlink" href={href(group)} aria-label={fill(t('c01.open_named'), { name: group.name })}>
                  <Icon name="forward" flip />
                </a>
              </li>
            ))}
          </ul>
        )}
      </>
    );

  return (
    <Page api={api} title={t('choice_groups.title')} end={end}>
      {body}
    </Page>
  );
}
