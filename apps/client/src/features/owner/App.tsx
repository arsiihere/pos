import { useState } from 'react';
import type { CloudAdmin } from '../../api/cloud-admin';
import { navigate, useHashRoute } from '../../app/router';
import { t } from '../../i18n';
import { BranchPicker } from './BranchPicker';
import { FloorsView } from './floors/FloorsView';
import { LoginView } from './login/LoginView';
import { MenuView } from './menu/MenuView';
import { StationsView } from './stations/StationsView';

// §8.1: the owner app. No token (or #/login) → login; otherwise the branch picker. The cloud client
// clears the tokens and calls onLoggedOut after a refused refresh, so a re-render lands on login.
export function App({ api }: { api: CloudAdmin }) {
  const route = useHashRoute();
  const [user, setUser] = useState(() => api.currentUser());
  const [branchId, setBranchId] = useState<string | null>(null);

  if (user === null || route === '/login' || api.currentUser() === null) {
    return (
      <main className="pos-screen">
        <LoginView
          api={api}
          onLoggedIn={(next) => {
            setUser(next);
            setBranchId(null);
            navigate('/');
          }}
        />
      </main>
    );
  }

  if (branchId !== null && route === '/floors') {
    return (
      <main className="pos-screen">
        <Nav />
        <FloorsView api={api} branchId={branchId} />
      </main>
    );
  }

  if (branchId !== null && route === '/stations') {
    return (
      <main className="pos-screen">
        <Nav />
        <StationsView api={api} branchId={branchId} />
      </main>
    );
  }

  if (branchId !== null && route === '/menu') {
    return (
      <main className="pos-screen">
        <Nav />
        <MenuView api={api} />
      </main>
    );
  }

  return (
    <main className="pos-screen">
      <BranchPicker branchIds={user.allowed_branch_ids} selectedId={branchId} onPick={setBranchId} />
      {branchId !== null && <Nav />}
    </main>
  );
}

function Nav() {
  return (
    <nav className="pos-row">
      <a className="pos-btn" href="#/">
        {t('owner.branches.title')}
      </a>
      <a className="pos-btn" href="#/floors">
        {t('owner.nav.floors')}
      </a>
      <a className="pos-btn" href="#/stations">
        {t('owner.nav.stations')}
      </a>
      <a className="pos-btn" href="#/menu">
        {t('owner.nav.menu')}
      </a>
    </nav>
  );
}
