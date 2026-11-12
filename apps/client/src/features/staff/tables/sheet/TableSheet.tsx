// stub (W0.6); owned by lane C, task 22a
// 02a §8 Table sheet (02-S06): actions of one table, for the seating the tile showed; mounts OrdersPart.
export interface TableSheetProps {
  table_id: string;
  /** the tile's seating_id (from #/tables/<id>?seating_id=), null for a free table */
  seating_id: string | null;
}

export const TableSheet: (props: TableSheetProps) => null = () => null;
