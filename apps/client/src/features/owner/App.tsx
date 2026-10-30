import { useEffect, useState } from 'react';
import type { CloudAdmin, OwnerUser } from '../../api/cloud-admin';
import { forcedRoute, matchOwnerRoute, navigate, useHashRoute } from '../../app/router';
import { t } from '../../i18n';
import { ChangePassword } from './account/ChangePassword';
import { BranchPicker } from './BranchPicker';
import { BranchesView } from './branches/BranchesView';
import { BranchSettings } from './branches/BranchSettings';
import { BranchNames, storeBranch, storedBranch } from './branch';
import { FloorsView } from './floors/FloorsView';
import { GuardProvider, useLeave } from './guard';
import { LoginView } from './login/LoginView';
import { MenuView } from './menu/MenuView';
import { Page, Shell } from './Shell';
import { SizeGroupForm } from './size-groups/SizeGroupForm';
import { SizeGroupList } from './size-groups/SizeGroupList';
import { StockItemForm } from './stock-items/StockItemForm';
import { StockItemList } from './stock-items/StockItemList';
import { RoleEditor } from './roles/RoleEditor';
import { RoleList } from './roles/RoleList';
import { StaffForm } from './staff/StaffForm';
import { StaffList } from './staff/StaffList';
import { StationsView } from './stations/StationsView';
import { StockCountingView } from './stock-counting/StockCountingView';
import { TeamsView } from './teams/TeamsView';

// §8.1: the owner app. No token (or #/login) → login. #/ is the branch picker, skipped with one branch
// (S52); #/menu needs no branch (S52, Q7); #/floors and #/stations need one and fall back to the picker.
// The cloud client clears the tokens and calls onLoggedOut after a refused refresh, so a re-render lands
// on login.
export function App({ api }: { api: CloudAdmin }) {
  return (
    <GuardProvider>
      <WithBranchNames api={api} />
    </GuardProvider>
  );
}

// S58: the branch names are read once per sign-in; until they arrive, or when the read fails, the ID tail shows.
function WithBranchNames({ api }: { api: CloudAdmin }) {
  const [user, setUser] = useState(() => api.currentUser());
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const userId = user?.user_id ?? null;

  useEffect(() => {
    if (userId === null) return;
    let live = true;
    void api.listBranches().then((result) => {
      if (live && result.ok) setNames(new Map(result.data.branches.map((b) => [b.branch_id, b.name])));
    });
    return () => {
      live = false;
    };
  }, [api, userId]);

  return (
    <BranchNames.Provider value={names}>
      <Routes api={api} user={user} setUser={setUser} />
    </BranchNames.Provider>
  );
}

function Routes({
  api,
  user,
  setUser,
}: {
  api: CloudAdmin;
  user: OwnerUser | null;
  setUser: (next: OwnerUser | null) => void;
}) {
  const route = useHashRoute();
  const leave = useLeave();
  const allowed = user?.allowed_branch_ids ?? [];
  const [branchId, setBranchId] = useState<string | null>(() => storedBranch(allowed));

  const loggedIn = user !== null && route !== '/login' && api.currentUser() !== null;
  const single = allowed.length === 1;
  // 01b §8, B05: read each render, so a PASSWORD_CHANGE_REQUIRED answer (stored by the client) applies at once.
  const mustChange = loggedIn && (api.currentUser()?.must_change_password ?? false);
  const forced = loggedIn ? forcedRoute(route, mustChange) : null;

  useEffect(() => {
    if (forced !== null) navigate(forced);
    else if (loggedIn && !mustChange && single && route === '/') navigate('/menu');
  }, [forced, loggedIn, mustChange, single, route]);

  function chooseBranch(next: string) {
    storeBranch(next);
    setBranchId(next);
  }

  function signOut() {
    void api.logout().then(() => {
      storeBranch(null);
      setBranchId(null);
      setUser(null);
      navigate('/login');
    });
  }

  if (!loggedIn) {
    return (
      <LoginView
        api={api}
        onLoggedIn={(next) => {
          setUser(next);
          setBranchId(storedBranch(next.allowed_branch_ids));
          navigate('/');
        }}
      />
    );
  }

  // 01b §8 B05: forced change after a support reset, with no side nav.
  if (mustChange) {
    return (
      <div className="pos-page">
        <ChangePassword
          api={api}
          userName={user.display_name}
          forced
          onChanged={() => {
            setUser(api.currentUser());
            navigate('/');
          }}
        />
        <div className="pos-content pos-content--narrow">
          <button type="button" className="pos-btn" onClick={signOut}>
            {t('owner.sign_out')}
          </button>
        </div>
      </div>
    );
  }

  // 01b §8: the 01b views. Staff and roles cover every branch (B8) and need no chosen branch; Teams and
  // Stock counting are per branch and fall back to the picker, as Floors and Stations do.
  const owner = matchOwnerRoute(route);
  const ownerNeedsBranch = owner?.name === 'teams' || owner?.name === 'stock_counting';
  const needsBranch = route === '/floors' || route === '/stations' || ownerNeedsBranch;
  if (owner !== null && (!ownerNeedsBranch || branchId !== null)) {
    return (
      <Shell route={route} userName={user.display_name} counts={{ branches: allowed.length }} onSignOut={signOut}>
        {owner.name === 'staff' && <StaffList api={api} branchIds={allowed} />}
        {owner.name === 'staff_new' && <StaffForm key="new" api={api} staffId={null} branchIds={allowed} />}
        {owner.name === 'staff_edit' && <StaffForm key={owner.id} api={api} staffId={owner.id} branchIds={allowed} />}
        {owner.name === 'roles' && <RoleList api={api} />}
        {owner.name === 'role_edit' && <RoleEditor key={owner.id} api={api} roleId={owner.id} />}
        {owner.name === 'account_password' && (
          <ChangePassword api={api} userName={user.display_name} forced={false} onChanged={() => setUser(api.currentUser())} />
        )}
        {owner.name === 'branches' && <BranchesView api={api} />}
        {owner.name === 'branch_settings' && <BranchSettings key={owner.id} api={api} branchId={owner.id} />}
        {owner.name === 'teams' && branchId !== null && (
          <TeamsView api={api} branchId={branchId} branchIds={allowed} onBranch={chooseBranch} />
        )}
        {owner.name === 'stock_counting' && branchId !== null && (
          <StockCountingView key={branchId} api={api} branchId={branchId} branchIds={allowed} onBranch={chooseBranch} />
        )}
        {owner.name === 'size_groups' && <SizeGroupList api={api} />}
        {owner.name === 'size_group_edit' && <SizeGroupForm key={owner.id} api={api} groupId={owner.id} />}
        {owner.name === 'stock_items' && <StockItemList api={api} branchIds={allowed} />}
        {owner.name === 'stock_item_edit' && <StockItemForm key={owner.id} api={api} stockItemId={owner.id} branchIds={allowed} />}
        {/* 01c-S02 and S04 are built by the next 01c groups; the nav entries already lead here. */}
        {owner.name === 'choice_groups' && <Page api={api} title={t('owner.nav.choice_groups')}>{null}</Page>}
        {owner.name === 'deals' && <Page api={api} title={t('owner.nav.deals')}>{null}</Page>}
      </Shell>
    );
  }
  // 01c: #/menu?item=… and #/menu?new_size_of=… (size group and stock item Open links) are the menu view too.
  const isMenu = route.split('?')[0] === '/menu';
  if (isMenu || (needsBranch && branchId !== null)) {
    return (
      <Shell route={route} userName={user.display_name} counts={{ branches: allowed.length }} onSignOut={signOut}>
        {isMenu && <MenuView api={api} />}
        {route === '/floors' && branchId !== null && (
          <FloorsView api={api} branchId={branchId} branchIds={allowed} onBranch={chooseBranch} />
        )}
        {route === '/stations' && branchId !== null && (
          <StationsView api={api} branchId={branchId} branchIds={allowed} onBranch={chooseBranch} />
        )}
      </Shell>
    );
  }

  return (
    <BranchPicker
      branchIds={allowed}
      selectedId={branchId}
      userName={user.display_name}
      onContinue={(next) => {
        chooseBranch(next);
        navigate(needsBranch ? route : '/floors');
      }}
      onSignOut={() => leave(signOut)}
    />
  );
}
