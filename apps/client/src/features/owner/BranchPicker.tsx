import { useState } from 'react';
import { AppBar } from '../../components/AppBar';
import { fill } from '../../i18n/en';
import { t, typeClass } from '../../i18n';
import { idTail } from './branch';

// §8.1 #/ (01a-S02): pick the branch to set up; branches show as ID tails until 01b names them (S37,
// S52). The menu needs no branch (S52, Q7), so the callout links straight to it.
export function BranchPicker({
  branchIds,
  selectedId,
  userName,
  onContinue,
  onSignOut,
}: {
  branchIds: readonly string[];
  selectedId: string | null;
  userName: string;
  onContinue: (branchId: string) => void;
  onSignOut: () => void;
}) {
  const [picked, setPicked] = useState(selectedId);
  return (
    <div className="pos-page">
      <AppBar title={t('owner.title')}>
        <span className={typeClass('body')}>{userName}</span>
        <button type="button" className="pos-btn" onClick={onSignOut}>
          {t('owner.sign_out')}
        </button>
      </AppBar>
      <main className="pos-content pos-content--narrow">
        <div className="pos-section__head">
          <h1 className={typeClass('title')}>{t('owner.branch_title')}</h1>
          <p className={typeClass('body-lg')}>{t('owner.branch_body')}</p>
        </div>
        <div className="pos-tiles pos-tiles--pick">
          {branchIds.map((id) => (
            <button
              key={id}
              type="button"
              className="pos-tile"
              data-branch-id={id}
              aria-pressed={id === picked}
              onClick={() => setPicked(id)}
            >
              <strong className="pos-ltr">{idTail(id)}</strong>
            </button>
          ))}
        </div>
        <p className="pos-explain">{t('owner.branch_ids_note')}</p>
        <div className="pos-callout">
          <div className="pos-callout__text">
            <h2>{t('owner.menu_shared_title')}</h2>
            <p>{t('owner.menu_shared_body')}</p>
          </div>
          <a className="pos-btn" href="#/menu">
            {t('owner.open_menu')}
          </a>
        </div>
        {picked !== null && (
          <button type="button" className="pos-btn pos-btn--primary pos-btn--lg" onClick={() => onContinue(picked)}>
            {fill(t('owner.continue_with'), { branch: idTail(picked) })}
          </button>
        )}
      </main>
    </div>
  );
}
