import { t } from '../../i18n';

// §8.1 #/: branch picker from the JWT's allowed_branch_ids; branch ids are shown until 01b adds
// GET /v1/admin/branches (S37).
export function BranchPicker({
  branchIds,
  selectedId,
  onPick,
}: {
  branchIds: readonly string[];
  selectedId: string | null;
  onPick: (branchId: string) => void;
}) {
  return (
    <section className="pos-stack">
      <h1 className="title">{t('owner.branches.title')}</h1>
      <div className="pos-staff">
        {branchIds.map((id) => (
          <button
            key={id}
            type="button"
            className="pos-staff__tile pos-ltr"
            data-branch-id={id}
            aria-pressed={id === selectedId}
            onClick={() => onPick(id)}
          >
            {id}
          </button>
        ))}
      </div>
    </section>
  );
}
