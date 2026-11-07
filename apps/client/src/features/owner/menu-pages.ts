import type { CloudAdmin, CloudResult, MenuItem, MenuPage } from '../../api/cloud-admin';

// 01c §6.3, §8: the views that name sizes and dishes (size groups, stock items) read every menu page; the
// page's lists (categories, variant groups, tax classes) come whole with each page and are kept from the first.
export const MENU_PAGE_LIMIT = 200;

export type WholeMenu = Omit<MenuPage, 'items' | 'next_cursor'> & { items: MenuItem[] };

export async function loadWholeMenu(api: CloudAdmin, status: 'active' | 'archived' = 'active'): Promise<CloudResult<WholeMenu>> {
  const first = await api.getMenu({ status, limit: MENU_PAGE_LIMIT });
  if (!first.ok) return first;
  const { items, next_cursor, ...rest } = first.data;
  const all = [...items];
  let cursor = next_cursor;
  while (cursor != null) {
    const page = await api.getMenu({ status, limit: MENU_PAGE_LIMIT, cursor });
    if (!page.ok) return page;
    all.push(...page.data.items);
    cursor = page.data.next_cursor;
  }
  return { ok: true, data: { ...rest, items: all } };
}

// Active and archived items together (size group members include archived sizes, AD-8).
export async function loadEveryItem(api: CloudAdmin): Promise<CloudResult<WholeMenu>> {
  const active = await loadWholeMenu(api, 'active');
  if (!active.ok) return active;
  const archived = await loadWholeMenu(api, 'archived');
  if (!archived.ok) return archived;
  return { ok: true, data: { ...active.data, items: [...active.data.items, ...archived.data.items] } };
}

// 01c §8 "Omitted at a branch" (m11, N9): every active menu page in order, each handed to `onPage` as it
// arrives with the items so far; `done` is true only after the page whose next_cursor is null, so a view can
// show "Checking branches…" until then and never warn from a partial load.
export async function loadMenuPages(
  api: CloudAdmin,
  onPage: (menu: WholeMenu, done: boolean) => void,
): Promise<CloudResult<WholeMenu>> {
  const all: MenuItem[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await api.getMenu({ status: 'active', limit: MENU_PAGE_LIMIT, ...(cursor === undefined ? {} : { cursor }) });
    if (!page.ok) return page;
    const { items, next_cursor, ...rest } = page.data;
    all.push(...items);
    const menu = { ...rest, items: [...all] };
    onPage(menu, next_cursor == null);
    if (next_cursor == null) return { ok: true, data: menu };
    cursor = next_cursor;
  }
}
