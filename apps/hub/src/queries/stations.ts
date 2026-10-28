import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { defineQuery, queryRegistry } from './registry.js';

// §6.18b, M88: active stations with what they cook, for the approve page's station tiles. 0 queries (01a S40).
export function registerStationsQuery(app: FastifyInstance): void {
  queryRegistry(app).register(
    defineQuery({
      resource: 'stations',
      sessionKind: 'admin',
      session: 'none',
      countsAsActivity: false,
      querySchema: z.object({}),
      handle(ctx) {
        const config = ctx.branchConfig;
        if (config === null) return { data: { stations: [] } };
        const categories = [...config.categories].sort((a, b) => a.sort_order - b.sort_order);
        return {
          data: {
            stations: config.stations
              .filter((station) => !station.is_archived)
              .map((station) => {
                const used = new Set(config.items.filter((item) => item.station_id === station.station_id).map((item) => item.category_id));
                return {
                  station_id: station.station_id,
                  name: station.name,
                  location_label: station.location_label,
                  category_names: categories
                    .filter((category) => used.has(category.category_id))
                    .slice(0, 3)
                    .map((category) => category.name),
                };
              }),
          },
        };
      },
    }),
  );
}
