-- 03c v1.0.13 §5 (05 row P-1, R-22): hub migration 0022_bill_routes. Bill routes: where a bill / receipt / report prints.
-- print_config projection (reset): BillRouteSet (a 'null' printer_id deletes the row). One route per (scope, ref_id);
-- ref_id is '' (branch level) for 'report' and 'default', the entity id for 'zone' | 'floor' | 'device'.
CREATE TABLE bill_routes (
  scope TEXT NOT NULL CHECK (scope IN ('zone','floor','device','report','default')),
  ref_id TEXT NOT NULL,
  printer_id TEXT NOT NULL,
  PRIMARY KEY (scope, ref_id),
  CHECK ((scope IN ('report','default')) = (ref_id = ''))
);
