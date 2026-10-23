import type { WriterTx } from '../engine-host/writer.js';

type StationValidator = (tx: WriterTx, stationId: string) => boolean;

let validator: StationValidator | undefined;

export function registerStationValidator(fn: StationValidator): void {
  validator = fn;
}

export function stationExists(tx: WriterTx, stationId: string): boolean {
  if (validator === undefined) return false;
  return validator(tx, stationId);
}
