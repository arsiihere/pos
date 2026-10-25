import { registerStationValidator } from '../auth/station-validator.js';
import { branchConfig } from './branch-config-holder.js';

// §6.22, M31: memory only; the single writer keeps the config from swapping mid-transaction.
registerStationValidator((_tx, stationId) => {
  const c = branchConfig();
  return c !== null && c.stations.some((s) => s.station_id === stationId && !s.is_archived);
});
