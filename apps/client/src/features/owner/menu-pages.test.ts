import { describe, expect, it } from 'vitest';
import { loadWholeMenu } from './menu-pages';
import type { CloudAdmin } from '../../api/cloud-admin';

describe('[01c §8] menu pages', () => {
  it('a page without next_cursor ends the read', async () => {
    let reads = 0;
    const api = {
      getMenu: async () => {
        reads += 1;
        if (reads > 5) throw new Error('read again and again');
        return { ok: true, data: { can_edit_tenant: true, tax_classes: [], categories: [], variant_groups: [], items: [] } };
      },
    } as unknown as CloudAdmin;
    const result = await loadWholeMenu(api).catch(() => null);
    expect(result).not.toBeNull();
    expect(reads).toBe(1);
  });
});
