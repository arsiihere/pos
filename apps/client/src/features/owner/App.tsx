import { useEffect, useState } from 'react';
import type { CloudAdmin, OwnerUser } from '../../api/cloud-admin';
import { matchOwnerRoute, navigate, useHashRoute } from '../../app/router';
import { BranchPicker } from './BranchPicker';
import { BranchNames, storeBranch, storedBranch } from './branch';
import { FloorsView } from './floors/FloorsView';
import { GuardProvider, useLeave } from './guard';
import { LoginView } from './login/LoginView';
import { MenuView } from './menu/MenuView';
import { Shell } from './Shell';
import { RoleEditor } from './roles/RoleEditor';
import { RoleList } from './roles/RoleList';
import { StaffForm } from './staff/StaffForm';
import { StaffList } from './staff/StaffList';
import { StationsView } from './stations/StationsView';

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

  useEffect(() => {
    if (loggedIn && single && route === '/') navigate('/menu');
  }, [loggedIn, single, route]);

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

  const needsBranch = route === '/floors' || route === '/stations';
  // 01b §8: the 01b views; staff and roles cover every branch (B8) and need no chosen branch.
  const owner = matchOwnerRoute(route);
  if (owner !== null) {
    return (
      <Shell route={route} userName={user.display_name} counts={{ branches: allowed.length }} onSignOut={signOut}>
        {owner.name === 'staff' && <StaffList api={api} branchIds={allowed} />}
        {owner.name === 'staff_new' && <StaffForm key="new" api={api} staffId={null} branchIds={allowed} />}
        {owner.name === 'staff_edit' && <StaffForm key={owner.id} api={api} staffId={owner.id} branchIds={allowed} />}
        {owner.name === 'roles' && <RoleList api={api} />}
        {owner.name === 'role_edit' && <RoleEditor key={owner.id} api={api} roleId={owner.id} />}
      </Shell>
    );
  }
  if (route === '/menu' || (needsBranch && branchId !== null)) {
    return (
      <Shell route={route} userName={user.display_name} counts={{ branches: allowed.length }} onSignOut={signOut}>
        {route === '/menu' && <MenuView api={api} />}
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
