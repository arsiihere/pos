import { Icon } from './Icon';

// 01c not found (Q17): the form is replaced by an icon, "This {thing} isn't here any more", a line and
// "Back to {list}" (the one primary). The caller reloads its list when it goes back.
export function Gone({ title, body, back, onBack }: { title: string; body: string; back: string; onBack: () => void }) {
  return (
    <div className="pos-gone" role="status">
      <span className="pos-gone__icon">
        <Icon name="info" />
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      <button type="button" className="pos-btn pos-btn--primary" onClick={onBack}>
        {back}
      </button>
    </div>
  );
}
