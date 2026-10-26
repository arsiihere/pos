import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '../../components/Dialog';
import { fill } from '../../i18n/en';
import { t } from '../../i18n';

// S50 c (D02): leaving a form with unsaved changes asks first. Forms register what changed; every way
// out (Cancel, Back, a menu item, the branch select, Sign out) goes through leave().
export interface DirtyForm {
  name: string;
  fields: readonly string[];
}

interface Guard {
  set: (id: string, form: DirtyForm | null) => void;
  leave: (proceed: () => void) => void;
}

const GuardContext = createContext<Guard | null>(null);

function joinFields(fields: readonly string[]): string {
  if (fields.length <= 1) return fields[0] ?? '';
  return `${fields.slice(0, -1).join(', ')} ${t('common.and')} ${fields.at(-1) ?? ''}`;
}

export function GuardProvider({ children }: { children: ReactNode }) {
  const forms = useRef(new Map<string, DirtyForm>());
  const [asking, setAsking] = useState<{ form: DirtyForm; proceed: () => void } | null>(null);

  const set = useCallback((id: string, form: DirtyForm | null) => {
    if (form === null) forms.current.delete(id);
    else forms.current.set(id, form);
  }, []);

  const leave = useCallback((proceed: () => void) => {
    const form = [...forms.current.values()][0];
    if (form === undefined) proceed();
    else setAsking({ form, proceed });
  }, []);

  return (
    <GuardContext.Provider value={{ set, leave }}>
      {children}
      {asking !== null && (
        <Dialog
          title={fill(t('discard.title'), { name: asking.form.name })}
          onClose={() => setAsking(null)}
          footer={
            <>
              <button
                type="button"
                className="pos-btn pos-btn--danger"
                onClick={() => {
                  forms.current.clear();
                  setAsking(null);
                  asking.proceed();
                }}
              >
                {t('discard.discard')}
              </button>
              <button type="button" className="pos-btn pos-btn--primary" onClick={() => setAsking(null)}>
                {t('discard.keep')}
              </button>
            </>
          }
        >
          <p className="pos-dialog__body">{fill(t('discard.body'), { fields: joinFields(asking.form.fields) })}</p>
        </Dialog>
      )}
    </GuardContext.Provider>
  );
}

// A form calls this on every render with what changed (null when nothing did).
export function useDirtyForm(form: DirtyForm | null): void {
  const guard = useContext(GuardContext);
  const id = useId();
  const key = form === null ? '' : `${form.name}\u0000${form.fields.join('\u0000')}`;
  useEffect(() => {
    guard?.set(id, form);
  }, [guard, id, key]);
  useEffect(() => () => guard?.set(id, null), [guard, id]);
}

export function useLeave(): (proceed: () => void) => void {
  const guard = useContext(GuardContext);
  return guard?.leave ?? ((proceed) => proceed());
}
