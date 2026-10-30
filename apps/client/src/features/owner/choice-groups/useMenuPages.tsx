import { useCallback, useEffect, useState } from 'react';
import type { CloudAdmin } from '../../../api/cloud-admin';
import { Icon } from '../../../components/Icon';
import { t } from '../../../i18n';
import { errorText } from '../form';
import { loadMenuPages, type WholeMenu } from '../menu-pages';

// Every active menu page for the choice group views (§8 "Omitted at a branch", N9): the pages so far, `done`
// only after the last one, and the error of a failed page (with `retry` to start again from page 1), so a
// failed load never leaves "Checking branches…" or "Loading more items…" up for good.
export function useMenuPages(api: CloudAdmin) {
  const [menu, setMenu] = useState<WholeMenu | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void loadMenuPages(api, (next, last) => {
      if (!live) return;
      setMenu(next);
      setDone(last);
    }).then((result) => {
      if (live && !result.ok) setError(errorText(result.error) ?? '');
    });
    return () => {
      live = false;
    };
  }, [api, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setDone(false);
    setAttempt((n) => n + 1);
  }, []);
  return { menu, done, error, retry };
}

// The failed-load banner: what went wrong, what it means here, and Retry.
export function MenuRetry({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="pos-banner pos-banner--danger" role="alert" data-menu-error="">
      <Icon name="alert" />
      <p>
        {t('choice_groups.menu_failed')}
        {error !== '' && <small>{error}</small>}
      </p>
      <div className="pos-banner__action pos-row">
        <button type="button" className="pos-btn" onClick={onRetry}>
          <Icon name="reload" />
          {t('choice_groups.retry')}
        </button>
      </div>
    </div>
  );
}
