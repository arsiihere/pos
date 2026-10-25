import { useState, type FormEvent } from 'react';
import type { AvailabilityWindow, CloudAdmin, Category, PatchCategoryBody } from '../../../api/cloud-admin';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { t } from '../../../i18n';
import { errorText, isKeyMismatch, useIdempotencyKey } from '../form';
import { WindowsField } from './WindowsField';

// §6.13, §8.1: a category's name, sort number and Available hours (S47). A new category POSTs with the
// form's Idempotency-Key; an edit PATCHes only the changed fields. onSaved closes the form; its notice is
// shown by the list (a key mismatch, whose text says the list is reloaded).
const INT_RE = /^-?[0-9]+$/;

export function CategoryForm({
  api,
  category,
  onSaved,
  onCancel,
}: {
  api: CloudAdmin;
  category: Category | null;
  onSaved: (notice?: string | null) => void;
  onCancel: () => void;
}) {
  const { key } = useIdempotencyKey();
  const [name, setName] = useState(category?.name ?? '');
  const [sort, setSort] = useState(String(category?.sort_order ?? 0));
  const [windows, setWindows] = useState<AvailabilityWindow[] | null>(category?.availability_windows ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const sortOrder = Number(sort.trim());
    if (windows === null || !INT_RE.test(sort.trim()) || !Number.isSafeInteger(sortOrder)) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    const body = { name: name.trim(), sort_order: sortOrder, availability_windows: windows };
    setBusy(true);
    setError(null);
    let result;
    if (category === null) {
      result = await api.createCategory(body, key);
    } else {
      const patch: PatchCategoryBody = {};
      if (body.name !== category.name) patch.name = body.name;
      if (body.sort_order !== category.sort_order) patch.sort_order = body.sort_order;
      if (JSON.stringify(windows) !== JSON.stringify(category.availability_windows)) {
        patch.availability_windows = windows;
      }
      if (Object.keys(patch).length === 0) {
        setBusy(false);
        onSaved();
        return;
      }
      result = await api.patchCategory(category.category_id, patch);
    }
    setBusy(false);
    if (!result.ok) {
      setError(errorText(result.error));
      if (isKeyMismatch(result.error)) {
        // The form closes (a new one gets a new key) and the list is reloaded, so a create that did
        // commit is shown (form.ts).
        onSaved(errorText(result.error));
      }
      return;
    }
    onSaved();
  }

  return (
    <form className="pos-stack pos-card" data-form="category" noValidate onSubmit={(e) => void submit(e)}>
      <h2 className="title">{t(category === null ? 'owner.category.new' : 'owner.category.edit')}</h2>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.category.name')}</span>
        <input className="pos-input" name="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="pos-field">
        <span className="pos-field__label">{t('owner.common.sort_order')}</span>
        <input
          className="pos-input pos-input--mono"
          name="sort_order"
          inputMode="numeric"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        />
      </label>
      <WindowsField value={category?.availability_windows ?? []} onChange={setWindows} />
      {error !== null && <Banner tone="danger" text={error} />}
      <div className="pos-row">
        <BusyButton busy={busy} primary type="submit">
          {t('owner.common.save')}
        </BusyButton>
        <button type="button" className="pos-btn" onClick={onCancel}>
          {t('owner.common.cancel')}
        </button>
      </div>
    </form>
  );
}
