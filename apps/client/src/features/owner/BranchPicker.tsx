import { useContext, useState } from 'react';
import { Icon } from '../../components/Icon';
import { NavBrand } from '../../components/SideNav';
import { fill } from '../../i18n/en';
import { t, typeClass } from '../../i18n';
import { BranchNames, useBranchName } from './branch';

// §8.1 #/ (01a-S02): pick the branch to set up; branches show by name (S58; the ID tail until the names
// arrive, with a small note under the tiles), choice kept per tab (S52). The menu needs no branch (S52, Q7),
// so one link line leads straight to it (Pulse frame OwnerBranchPicker). No floor or station counts (S50 f).
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
  const names = useContext(BranchNames);
  const branchName = useBranchName();
  const [picked, setPicked] = useState(selectedId);
  return (
    <div className="pos-page">
      <header className="pos-appbar">
        <NavBrand title={userName} sub={t('owner.title')} avatar={userName} />
        <div className="pos-appbar__end">
          <span className={typeClass('caption')}>{userName}</span>
          <button type="button" className="pos-btn" onClick={onSignOut}>
            {t('owner.sign_out')}
          </button>
        </div>
      </header>
      <main className="pos-content pos-content--narrow pos-picker">
        <h1 className={typeClass('title')}>{t('owner.branch_title')}</h1>
        <p className={`pos-picker__lead ${typeClass('body-lg')}`}>{t('owner.branch_body')}</p>
        <div className="pos-tiles pos-tiles--pick" role="group" aria-label={t('owner.branch')}>
          {branchIds.map((id) => (
            <button
              key={id}
              type="button"
              className="pos-tile"
              data-branch-id={id}
              aria-pressed={id === picked}
              onClick={() => setPicked(id)}
            >
              <strong>
                <bdi>{branchName(id)}</bdi>
              </strong>
            </button>
          ))}
        </div>
        {branchIds.some((id) => !names.has(id)) && <p className="pos-note">{t('owner.picker.id_note')}</p>}
        <p className="pos-linkline">
          <Icon name="grid" />
          <span>{t('owner.picker.menu_line')}</span>
          <a href="#/menu">
            {t('owner.open_menu')}
            <Icon name="forward" flip />
          </a>
        </p>
        {picked !== null && (
          <div className="pos-row pos-picker__go">
            <button type="button" className="pos-btn pos-btn--primary pos-btn--lg" onClick={() => onContinue(picked)}>
              {fill(t('owner.continue_with'), { branch: branchName(picked) })}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
