import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { button, click, fakeApi, mount, ok, setValue, type Mounted } from '../test-api';
import { STAFF } from './fixtures';
import { PinDialog } from './PinDialog';

let m: Mounted;

beforeEach(() => {
  sessionStorage.clear();
  sessionStorage.setItem('owner_access_token', 'A1');
  m = mount();
});

afterEach(() => {
  m.unmount();
  sessionStorage.clear();
});

const bilal = STAFF[1]!;

function fields(): HTMLInputElement[] {
  return [...m.container.querySelectorAll<HTMLInputElement>('input[type="password"]')];
}

describe('[01b §8] PIN dialog', () => {
  it('[01b §8] PIN dialog clears the PIN after the request', async () => {
    let online = false;
    const { api, calls } = fakeApi(async () => {
      if (!online) throw new TypeError('offline');
      return ok({ staff: { ...bilal, version: 'v-S2' }, changed_versions: { staff: [], roles: [], responsibilities: [] } });
    });
    const saved: string[] = [];
    await m.render(
      <PinDialog api={api} staff={bilal} branchNames={['Gulberg']} onSaved={(s) => saved.push(s.staff_id)} onClose={() => {}} />,
    );

    const [pin, again] = fields();
    setValue(pin, '1234');
    setValue(again, '1234');
    await click(button(m.container, t('staff.pin.save')));
    expect(calls[0]).toMatchObject({ method: 'PUT', url: '/v1/admin/staff/S2/pin', body: { pin: '1234' } });
    // Failed request: nothing changed, and the typed PIN is gone.
    expect(m.container.textContent).toContain(t('staff.pin.offline'));
    expect(fields().map((f) => f.value)).toEqual(['', '']);

    online = true;
    const [pin2, again2] = fields();
    setValue(pin2, '5678');
    setValue(again2, '5678');
    await click(button(m.container, t('staff.pin.try_again')));
    expect(calls[1]?.body).toEqual({ pin: '5678' });
    expect(m.container.textContent).toContain(fill(t('staff.pin.saved_title'), { name: 'Bilal' }));
    expect(fields()).toEqual([]);
    expect(m.container.innerHTML).not.toContain('5678');
    expect(saved).toEqual(['S2']);
  });

  it('[01b §8] a short or different PIN is refused before any request', async () => {
    const { api, calls } = fakeApi(() => ok({}));
    await m.render(<PinDialog api={api} staff={bilal} branchNames={['Gulberg']} onSaved={() => {}} onClose={() => {}} />);
    const [pin, again] = fields();
    setValue(pin, '12');
    await click(button(m.container, t('staff.pin.save')));
    expect(m.container.textContent).toContain(t('staff.pin.short'));
    setValue(pin, '1234');
    setValue(again, '1235');
    await click(button(m.container, t('staff.pin.save')));
    expect(m.container.textContent).toContain(t('staff.pin.mismatch'));
    expect(calls).toEqual([]);
  });
});
