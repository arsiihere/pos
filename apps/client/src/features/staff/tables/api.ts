import type { HubResult } from '../../../api/hub-admin';
import type { CommandOptions } from '../api';
import type {
  CallWaiterPayload,
  CallWaiterResult,
  ForceMovePayload,
  ForceReleasePayload,
  HandoverCandidatesBody,
  HandoverPayload,
  MergeTablesPayload,
  MoveTablePayload,
  OpenTablePayload,
  OpenTableResult,
  SeatingRef,
  SplitSeatingPayload,
  TableMapBody,
  TablesApi,
} from './contracts';

// 02a §6.1–§6.18 (W0.4): the Tables commands and queries on the staff api's command() / query(). Every command posts
// `/commands/<kebab(type)>` with the §6 payload as given (the shown seating_id included); results as the hub sends
// them (docs/plans/02-client-gaps.md §1).

/** What createTablesApi needs of the staff api (features/staff/api.ts). */
export interface StaffTransport {
  command<T>(commandType: string, payload: unknown, opts?: CommandOptions): Promise<HubResult<T>>;
  query<T>(path: string): Promise<HubResult<T>>;
}

export function createTablesApi(staff: StaffTransport): TablesApi {
  const cmd =
    <P, R>(type: string) =>
    (payload: P): Promise<HubResult<R>> =>
      staff.command<R>(type, payload);
  return {
    openTable: cmd<OpenTablePayload, OpenTableResult>('OpenTable'),
    touchTableLock: cmd<SeatingRef, { touched: boolean }>('TouchTableLock'),
    releaseTableLock: cmd<SeatingRef, { released: boolean }>('ReleaseTableLock'),
    forceReleaseTableLock: cmd<ForceReleasePayload, { released: boolean }>('ForceReleaseTableLock'),
    takeOverTable: cmd<SeatingRef, { changed: boolean }>('TakeOverTable'),
    forceMoveTable: cmd<ForceMovePayload, { changed: boolean }>('ForceMoveTable'),
    requestTableHandover: cmd<HandoverPayload, { alert_id: string }>('RequestTableHandover'),
    moveTable: cmd<MoveTablePayload, { primary_table_id: string }>('MoveTable'),
    mergeTables: cmd<MergeTablesPayload, { seating_id: string; table_ids: string[] }>('MergeTables'),
    splitSeating: cmd<SplitSeatingPayload, { new_seating_id: string | null }>('SplitSeating'),
    requestBill: (p: SeatingRef, opts?: CommandOptions) => staff.command<{ requested: boolean }>('RequestBill', p, opts),
    cleanTable: (p: SeatingRef, opts?: CommandOptions) => staff.command<{ reason: 'cleaned' | 'left_without_order' }>('CleanTable', p, opts),
    callWaiter: cmd<CallWaiterPayload, CallWaiterResult>('CallWaiter'),
    tableMap: (floor_id?: string) =>
      staff.query<TableMapBody>(floor_id === undefined ? '/queries/table-map' : `/queries/table-map?floor_id=${encodeURIComponent(floor_id)}`),
    handoverCandidates: (table_id: string) =>
      staff.query<HandoverCandidatesBody>(`/queries/handover-candidates?table_id=${encodeURIComponent(table_id)}`),
  };
}
