import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLanguage } from '../../../../i18n';
import { flush, type Mounted } from '../../../../../test/dom';
import { screenHarness } from './screen-harness';

// ⚠️ 02b-TK L-CLIENT-4 item 3 (02b v1.0.25 §8; 05 v1.0.35 §6.3a Result, §8 R2-M-3: "the cart's own line sum stays
// labelled 'Items'"; frames HomeKiosk, HomeTablet, PhoneCart): the takeaway cart footer's own line sum (not computeBill:
// no tax, service charge or rounding) is labelled "Items" beside the same figure, on the kiosk / tablet cart and on the
// phone's sticky bar, in English and Urdu.

vi.mock('../../tables/lock/useTableLock', () => ({ useTableLock: () => ({ banner: null, canSend: true, release: async () => {} }) }));
vi.mock('../../tables/lock/LockBanner', () => ({ LockBanner: () => null }));
vi.mock('../../tables/offline/OfflineBar', () => ({ OfflineBar: () => null }));
vi.mock('../../../../app/router', async (orig) => ({ ...(await orig<object>()), navigate: () => {} }));

let m: Mounted | null = null;
afterEach(() => {
  m?.unmount();
  m = null;
  setLanguage('en');
  document.body.innerHTML = '';
});

const addNaan = (v: Mounted) => {
  v.click(v.button('Sides', v.container.querySelector('.pills')!));
  v.click(v.container.querySelector<HTMLElement>('.mi[aria-label="Naan"]'));
};

describe('[02b-TK L-CLIENT-4 item 3; 02b v1.0.25 §8; 05 v1.0.35 §6.3a, §8] the cart footer total is labelled "Items"', () => {
  it('[frame HomeKiosk] kiosk: "Items" beside the cart\'s own line sum, the figure kept', async () => {
    const v = (m = screenHarness({ rows: [] }).render());
    await flush();
    addNaan(v);
    addNaan(v);
    const total = v.container.querySelector('.cart__foot .tk-total')!;
    expect(total.querySelector('[data-items-label]')?.textContent).toBe('Items');
    expect(total.querySelector('strong')?.textContent).toBe('Rs 80');
  });

  it('[frame HomeTablet] landscape tablet: the same label on its cart', async () => {
    const v = (m = screenHarness({ rows: [], device: 'tablet' }).render());
    await flush();
    const total = v.container.querySelector('.cart__foot .tk-total')!;
    expect(total.querySelector('[data-items-label]')?.textContent).toBe('Items');
    expect(total.querySelector('strong')?.textContent).toBe('Rs 0');
  });

  it('[02b v1.0.25 §8 takeaway] a parking cart keeps its plain total (no label)', async () => {
    const v = (m = screenHarness({ rows: [] }).renderAs('parking', 'P1'));
    await flush();
    expect(v.container.querySelector('.cart__foot .total strong')).not.toBeNull();
    expect(v.container.querySelector('.cart__foot .tk-total [data-items-label]')).toBeNull();
  });

  it('[frame PhoneCart] phone: the sticky bar labels its total "Items"', async () => {
    const v = (m = screenHarness({ rows: [], phone: true }).render());
    await flush();
    const bar = v.container.querySelector('.sbar__t')!;
    expect(bar.querySelector('[data-items-label]')?.textContent).toBe('Items');
    expect(bar.querySelector('b')?.textContent).toBe('Rs 0');
  });

  it('[frames HomeUrdu, PhoneCartUrdu] Urdu: "آئٹم"', async () => {
    setLanguage('ur');
    const v = (m = screenHarness({ rows: [] }).render());
    await flush();
    expect(v.container.querySelector('.cart__foot .tk-total [data-items-label]')?.textContent).toBe('آئٹم');
    v.unmount();
    const p = (m = screenHarness({ rows: [], phone: true }).render());
    await flush();
    expect(p.container.querySelector('.sbar__t [data-items-label]')?.textContent).toBe('آئٹم');
  });
});
