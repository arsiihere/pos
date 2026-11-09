import { BRANCH_ENGINE_SETTING_KEYS } from '@pos/events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fill } from '../../../i18n/en';
import { t } from '../../../i18n';
import { GuardProvider } from '../guard';
import { button, click, fail, fakeApi, mount, ok, setValue, type Call, type Mounted } from '../test-api';
import { BranchSettings } from './BranchSettings';

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

const STORED = {
  branch_id: 'B1',
  name: 'Gulberg',
  status: 'active',
  hub_last_seen_at: null,
  hub_synced_at: null,
  tax_enabled: false,
  day_stale_after_hours: 16,
  day_min_gap_hours: 4,
  // 01a A-12 defaults.
  weight_dine_in_pct: 100,
  weight_takeaway_pct: 200,
  weight_delivery_pct: 200,
  weight_parking_pct: 200,
  weight_follow_up_pct: 300,
  promise_padding_dine_in_ms: 180_000,
  promise_padding_takeaway_ms: 180_000,
  promise_padding_delivery_ms: 180_000,
  promise_padding_parking_ms: 180_000,
  slip_threshold_ms: 120_000,
  slip_escalate_ms: 120_000,
  cascade_step_ms: 60_000,
  min_gain_ms: 60_000,
  table_lock_ttl_ms: 600_000,
  returns_boost: true,
  order_abandon_ms: 14_400_000,
  // 01a v2.3 A-1 (02b): the four ordering settings, served_estimate_ms (null until 03b) and the comp chips.
  queue_auto_send_max_ms: 14_400_000,
  zone_undo_ms: 300_000,
  slow_item_threshold_ms: 900_000,
  served_estimate_ms: null,
  comp_reason_chips: ['Late', 'Wrong item', 'Quality', 'Guest', 'Other'],
  version: 'v1',
};

async function render(onPatch?: (call: Call) => Response | undefined, stored: object = STORED) {
  const { api, calls } = fakeApi((call: Call) => {
    if (call.method === 'GET') return ok({ branch: stored });
    const answer = onPatch?.(call);
    if (answer !== undefined) return answer;
    return ok({ branch: { ...STORED, ...(call.body as object), version: 'v2' } });
  });
  await m.render(
    <GuardProvider>
      <BranchSettings api={api} branchId="B1" />
    </GuardProvider>,
  );
  return calls;
}

const field = (name: string) => m.container.querySelector<HTMLInputElement>(`input[name="${name}"]`);

describe('[01b §8] branch settings', () => {
  it('[01b §8] settings form keeps stale > gap before sending', async () => {
    const calls = await render();
    setValue(field('day_stale_after_hours'), '10');
    setValue(field('day_min_gap_hours'), '10');
    await click(button(m.container, t('branches.save_settings')));
    expect(m.container.textContent).toContain(fill(t('branches.gap_not_less'), { n: '10' }));
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);

    setValue(field('day_stale_after_hours'), '60');
    setValue(field('day_min_gap_hours'), '4');
    await click(button(m.container, t('branches.save_settings')));
    expect(m.container.textContent).toContain(t('branches.stale_range'));
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);

    // Only what changed is sent.
    setValue(field('day_stale_after_hours'), '10');
    await click(m.container.querySelector<HTMLButtonElement>('[role="switch"]')!);
    await click(button(m.container, t('branches.save_settings')));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/v1/admin/branches/B1/settings',
      body: { expected_version: 'v1', tax_enabled: true, day_stale_after_hours: 10 },
    });
    expect(m.container.textContent).toContain(fill(t('branches.settings_saved'), { name: 'Gulberg' }));

    // B23: the next save sends the version the last save answered.
    setValue(field('day_stale_after_hours'), '11');
    await click(button(m.container, t('branches.save_settings')));
    expect(calls.filter((c) => c.method === 'PATCH').at(-1)).toMatchObject({ body: { expected_version: 'v2', day_stale_after_hours: 11 } });
  });

  it('[01b §8, S50 c] phone: the back arrow asks before dropping changes', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 760px)', media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    try {
      window.location.hash = '#/branches/B1/settings';
      await render();
      const back = m.container.querySelector<HTMLAnchorElement>(`a[aria-label="${t('branches.back')}"]`)!;
      expect(back.textContent).toBe('');
      setValue(m.container.querySelector<HTMLInputElement>('input[name="day_stale_after_hours"]'), '20');
      await click(back);
      expect(window.location.hash).toBe('#/branches/B1/settings');
      const dialog = m.container.querySelector<HTMLElement>('[role="dialog"]')!;
      expect(dialog.textContent).toContain(t('discard.keep'));
      await click(button(dialog, t('discard.discard')));
      expect(window.location.hash).toBe('#/branches');
    } finally {
      vi.unstubAllGlobals();
      window.location.hash = '';
    }
  });

  // 01a §8.1 A-12, 01b B-6: the "Kitchen timing" group.
  it('[01a A-12] kitchen timing shows every engine field with its stored value, in minutes or percent', async () => {
    await render();
    const group = m.container.querySelector<HTMLElement>('[data-group="kitchen-timing"]')!;
    expect(group.textContent).toContain(t('branches.timing'));
    const names = [...group.querySelectorAll<HTMLInputElement>('input[name]')].map((i) => i.name);
    const ordering = ['queue_auto_send_max_ms', 'zone_undo_ms', 'slow_item_threshold_ms'];
    expect(names.sort()).toEqual(
      [...new Set([...BRANCH_ENGINE_SETTING_KEYS, ...ordering])].filter((k) => k !== 'returns_boost' && k !== 'served_estimate_ms' && k !== 'comp_reason_chips').sort(),
    );
    const value = (name: string) => group.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value;
    expect(value('weight_follow_up_pct')).toBe('300');
    expect(value('promise_padding_parking_ms')).toBe('3');
    expect(value('slip_threshold_ms')).toBe('2');
    expect(value('cascade_step_ms')).toBe('1');
    expect(value('table_lock_ttl_ms')).toBe('10');
    expect(value('order_abandon_ms')).toBe('240');
    expect(group.querySelector('[role="switch"]')!.getAttribute('aria-checked')).toBe('true');
  });

  it('[01a A-12] kitchen timing sends only the changed fields, minutes as ms, with expected_version', async () => {
    const calls = await render();
    setValue(field('promise_padding_dine_in_ms'), '4');
    setValue(field('weight_delivery_pct'), '250');
    setValue(field('cascade_step_ms'), '0.25');
    await click(m.container.querySelector<HTMLButtonElement>('[data-group="kitchen-timing"] [role="switch"]')!);
    await click(button(m.container, t('branches.save_settings')));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/v1/admin/branches/B1/settings',
      body: { expected_version: 'v1', promise_padding_dine_in_ms: 240_000, weight_delivery_pct: 250, cascade_step_ms: 15_000, returns_boost: false },
    });
    expect(Object.keys(calls.find((c) => c.method === 'PATCH')!.body as object).sort()).toEqual(
      ['cascade_step_ms', 'expected_version', 'promise_padding_dine_in_ms', 'returns_boost', 'weight_delivery_pct'],
    );
  });

  it('[01a A-12] kitchen timing refuses a value outside the range before sending', async () => {
    const calls = await render();
    setValue(field('slip_escalate_ms'), '0.25');
    setValue(field('weight_dine_in_pct'), '5');
    await click(button(m.container, t('branches.save_settings')));
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
    expect(m.container.textContent).toContain(fill(t('branches.timing_minutes_range'), { min: '0.5', max: '30' }));
    expect(m.container.textContent).toContain(fill(t('branches.timing_pct_range'), { min: '10', max: '1000' }));
  });

  describe('[01a v2.1 §8.1] Save is in the bar over a long page, so its answer is brought into view', () => {
    let seen: Element[];
    beforeEach(() => {
      seen = [];
      (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = function (this: Element) {
        seen.push(this);
      };
    });
    afterEach(() => {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    });

    it('Changed elsewhere', async () => {
      await render((call) => (call.method === 'PATCH' ? fail(409, 'CONFIG_STALE') : undefined));
      setValue(field('min_gain_ms'), '2');
      await click(button(m.container, t('branches.save_settings')));
      expect(seen.at(-1)).toBe(m.container.querySelector('[data-stale]'));
    });

    it('Settings saved', async () => {
      await render();
      setValue(field('min_gain_ms'), '2');
      await click(button(m.container, t('branches.save_settings')));
      expect(seen.at(-1)?.textContent).toContain(fill(t('branches.settings_saved'), { name: 'Gulberg' }));
    });

    it('a box out of range', async () => {
      await render();
      setValue(field('cascade_step_ms'), '0.1');
      await click(button(m.container, t('branches.save_settings')));
      expect(seen.at(-1)).toBe(field('cascade_step_ms')!.closest('label'));
    });
  });

  it('[01a v2.1 §8.1; A-12] at phone width the timing boxes are one column: three crushed them to 32 px, hiding the value', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 760px)', media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    await render();
    const group = m.container.querySelector('[data-group="kitchen-timing"]')!;
    expect(group.querySelector('input[name="min_gain_ms"]')).not.toBeNull();
    expect(group.querySelector('.pos-grid--3')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('[01a v2.1 §8.1; A-12] on a laptop they stay three across', async () => {
    await render();
    expect(m.container.querySelectorAll('[data-group="kitchen-timing"] .pos-grid--3').length).toBe(4);
  });

  it('[01b B23] a stale version shows Changed elsewhere, keeps the draft, and Reload reads the branch again', async () => {
    const calls = await render((call) => (call.method === 'PATCH' ? fail(409, 'CONFIG_STALE') : undefined));
    setValue(field('min_gain_ms'), '2');
    await click(button(m.container, t('branches.save_settings')));
    expect(m.container.textContent).toContain(t('stale.title'));
    expect(field('min_gain_ms')!.value).toBe('2');
    expect(button(m.container, t('branches.save_settings')).disabled).toBe(true);
    const gets = calls.filter((c) => c.method === 'GET').length;
    await click(button(m.container, t('stale.reload')));
    expect(calls.filter((c) => c.method === 'GET').length).toBe(gets + 1);
    expect(m.container.textContent).not.toContain(t('stale.title'));
    expect(field('min_gain_ms')!.value).toBe('1');
  });

  // 01a v2.3 §5.2a (02b A-1): three ordering times in minutes, the comp reason chips as a list.
  it('[01a #193 client] settings form shows and sends the four settings and the chips', async () => {
    const calls = await render();
    const group = m.container.querySelector<HTMLElement>('[data-group="kitchen-timing"]')!;
    const value = (name: string) => group.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value;
    expect(value('queue_auto_send_max_ms')).toBe('240');
    expect(value('zone_undo_ms')).toBe('5');
    expect(value('slow_item_threshold_ms')).toBe('15');
    // served_estimate_ms is "null until 03b": no box for it.
    expect(m.container.querySelector('input[name="served_estimate_ms"]')).toBeNull();
    const chips = () => [...m.container.querySelectorAll<HTMLInputElement>('[data-group="comp-chips"] input[name="comp_reason_chips"]')].map((i) => i.value);
    expect(chips()).toEqual(['Late', 'Wrong item', 'Quality', 'Guest', 'Other']);

    setValue(field('queue_auto_send_max_ms'), '120');
    setValue(field('zone_undo_ms'), '2');
    setValue(field('slow_item_threshold_ms'), '25');
    const chipBox = (i: number) => m.container.querySelectorAll<HTMLInputElement>('[data-group="comp-chips"] input[name="comp_reason_chips"]')[i];
    setValue(chipBox(0), 'Slow');
    await click(m.container.querySelectorAll<HTMLButtonElement>('[data-group="comp-chips"] [data-chip-remove]')[3]!);
    await click(button(m.container, t('branches.chips.add')));
    setValue(chipBox(4), 'Spilled');
    await click(button(m.container, t('branches.save_settings')));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.body).toEqual({
      expected_version: 'v1',
      queue_auto_send_max_ms: 7_200_000,
      zone_undo_ms: 120_000,
      slow_item_threshold_ms: 1_500_000,
      comp_reason_chips: ['Slow', 'Wrong item', 'Quality', 'Other', 'Spilled'],
    });
  });

  it('[01a #193 client] a time or a chip outside its range is refused before sending; unchanged chips are not sent', async () => {
    const calls = await render();
    setValue(field('queue_auto_send_max_ms'), '30');
    setValue(field('zone_undo_ms'), '31');
    setValue(field('slow_item_threshold_ms'), '0.5');
    await click(button(m.container, t('branches.save_settings')));
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
    expect(m.container.textContent).toContain(fill(t('branches.timing_minutes_range'), { min: '60', max: '1440' }));
    expect(m.container.textContent).toContain(fill(t('branches.timing_minutes_range'), { min: '0', max: '30' }));
    expect(m.container.textContent).toContain(fill(t('branches.timing_minutes_range'), { min: '1', max: '120' }));

    setValue(field('queue_auto_send_max_ms'), '240');
    setValue(field('zone_undo_ms'), '5');
    setValue(field('slow_item_threshold_ms'), '15');
    const first = m.container.querySelector<HTMLInputElement>('[data-group="comp-chips"] input[name="comp_reason_chips"]');
    setValue(first, 'x'.repeat(31));
    await click(button(m.container, t('branches.save_settings')));
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
    expect(m.container.textContent).toContain(fill(t('branches.chips.range'), { max: '30', n: '10' }));

    setValue(first, 'Late');
    setValue(field('min_gain_ms'), '2');
    await click(button(m.container, t('branches.save_settings')));
    expect(Object.keys(calls.find((c) => c.method === 'PATCH')!.body as object).sort()).toEqual(['expected_version', 'min_gain_ms']);
  });

  it('[01a AD-19] the form refuses two chips that differ only in case, with an inline message, and sends nothing', async () => {
    const calls = await render();
    const boxes = () => m.container.querySelectorAll<HTMLInputElement>('[data-group="comp-chips"] input[name="comp_reason_chips"]');
    setValue(boxes()[1], 'late');
    await click(button(m.container, t('branches.save_settings')));
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
    expect(m.container.querySelector('[data-group="comp-chips"]')?.textContent).toContain(t('branches.chips.duplicate'));
    expect(t('branches.chips_help')).not.toContain('note');
  });
});

