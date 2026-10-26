import { useEffect, useState } from 'react';
import type { CloudAdmin } from '../../api/cloud-admin';
import { navigate, useHashRoute } from '../../app/router';
import { BranchPicker } from './BranchPicker';
import { storeBranch, storedBranch } from './branch';
import { FloorsView } from './floors/FloorsView';
import { GuardProvider, useLeave } from './guard';
import { LoginView } from './login/LoginView';
import { MenuView } from './menu/MenuView';
import { Shell } from './Shell';
import { StationsView } from './stations/StationsView';

// §8.1: the owner app. No token (or #/login) → login. #/ is the branch picker, skipped with one branch
// (S52); #/menu needs no branch (S52, Q7); #/floors and #/stations need one and fall back to the picker.
// The cloud client clears the tokens and calls onLoggedOut after a refused refresh, so a re-render lands
// on login.
export function App({ api }: { api: CloudAdmin }) {
  return (
    <GuardProvider>
      <Routes api={api} />
    </GuardProvider>
  );
}

function Routes({ api }: { api: CloudAdmin }) {
  const route = useHashRoute();
  const leave = useLeave();
  const [user, setUser] = useState(() => api.currentUser());
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
  if (route === '/menu' || (needsBranch && branchId !== null)) {
    return (
      <Shell route={route} userName={user.display_name} onSignOut={signOut}>
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
