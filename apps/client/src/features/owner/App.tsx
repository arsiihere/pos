import { useState } from 'react';
import type { CloudAdmin } from '../../api/cloud-admin';
import { navigate, useHashRoute } from '../../app/router';
import { BranchPicker } from './BranchPicker';
import { LoginView } from './login/LoginView';

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

  return (
    <main className="pos-screen">
      <BranchPicker branchIds={user.allowed_branch_ids} selectedId={branchId} onPick={setBranchId} />
    </main>
  );
}
