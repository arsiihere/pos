import { useCallback, useEffect, useState } from 'react';
import type { HubAdmin } from '../../../api/hub-admin';
import { t } from '../../../i18n';
import { AdminLogin } from './AdminLogin';

// §8.2: no admin session → the roster and PIN pad; with one → the stock view. A `signed_out` answer
// (the hub ended the session) goes back to the roster.
export function StockApp({ api }: { api: HubAdmin }) {
  const [signedIn, setSignedIn] = useState(() => api.hasSession());
  const signedOut = useCallback(() => setSignedIn(false), []);

  if (!signedIn) return <AdminLogin api={api} onLoggedIn={() => setSignedIn(true)} />;
  return <StockView api={api} onSignedOut={signedOut} />;
}

function StockView({ api, onSignedOut }: { api: HubAdmin; onSignedOut: () => void }) {
  // D7: config-status on open gives the tenant_id and branch_id every command envelope carries.
  useEffect(() => {
    let live = true;
    void api.configStatus().then((answer) => {
      if (live && !answer.ok && answer.error.kind === 'signed_out') onSignedOut();
    });
    return () => {
      live = false;
    };
  }, [api, onSignedOut]);

  return (
    <main className="pos-screen" data-view="stock">
      <h1 className="title">{t('admin_stock.title')}</h1>
    </main>
  );
}
