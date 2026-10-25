import { FloorListResponse, LoginResponse, MenuResponse, StationListResponse } from '@pos/events';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OWNER_PASSWORD, owner, restaurantFixture, seedMenu, type RestaurantFixture } from '../helpers/restaurant';
import { createTestCloud, type TestCloud } from '../helpers/test-cloud';

// D5: the owner app and the cloud routes share the admin response schemas from @pos/events (§7.7).
describe('shared admin schemas', () => {
  let cloud: TestCloud;
  let f: RestaurantFixture;

  beforeAll(async () => {
    cloud = await createTestCloud();
    await cloud.app.ready();
  });
  afterAll(async () => {
    await cloud.close();
  });
  beforeEach(async () => {
    f = await restaurantFixture(cloud);
  });

  it('[01a §7.7] real owner responses parse with the shared @pos/events schemas', async () => {
    await seedMenu(cloud.pool, f, { items: 3, archived: true });
    const get = (url: string) => cloud.app.inject({ method: 'GET', url, ...owner(f) });

    const login = await cloud.app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'a@example.com', password: OWNER_PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    expect(LoginResponse.parse(login.json())).toEqual(login.json());

    const floors = await get(`/v1/admin/branches/${f.branches[0]}/floors`);
    expect(floors.json().data.floors.length).toBeGreaterThan(0);
    expect(FloorListResponse.parse(floors.json())).toEqual(floors.json());

    const stations = await get(`/v1/admin/branches/${f.branches[0]}/stations`);
    expect(stations.json().data.stations.length).toBeGreaterThan(0);
    expect(StationListResponse.parse(stations.json())).toEqual(stations.json());

    const menu = await get('/v1/admin/menu');
    expect(menu.json().data.items.length).toBeGreaterThan(0);
    expect(MenuResponse.parse(menu.json())).toEqual(menu.json());
  });
});
