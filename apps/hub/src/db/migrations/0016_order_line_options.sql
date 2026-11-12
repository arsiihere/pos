-- 02b v1.0.7 §5 (owner 2026-11-11, B3-2) with 02b v1.0.9 (B3-5): plain options (ItemAdded.options as
-- [{ name, quantity }], NULL = none) on order_lines, read by 03b buildLineDetails (03b §4.4) and 03c's tickets
-- (03c §3.3, §3.6).
ALTER TABLE order_lines ADD COLUMN options_json TEXT;
-- B3-5 backfill in SQL, no projection rebuild (the orders checkpoint stays): every existing line gets what the live
-- fold writes from its ItemAdded — the first copy by seq, as the fold's ON CONFLICT DO NOTHING keeps — the payload's
-- options in payload order as [{ name, quantity }]; none → NULL (left as is). One pass over the ItemAdded events.
UPDATE order_lines
   SET options_json = a.options_json
  FROM (SELECT id, options_json
          FROM (SELECT json_extract(e.payload, '$.order_item_id') AS id,
                       (SELECT json_group_array(json_object('name', json_extract(o.value, '$.name'),
                                                            'quantity', json_extract(o.value, '$.quantity')))
                          FROM (SELECT o0.value FROM json_each(e.payload, '$.options') o0 ORDER BY o0.key) o) AS options_json,
                       json_array_length(e.payload, '$.options') AS n,
                       ROW_NUMBER() OVER (PARTITION BY json_extract(e.payload, '$.order_item_id') ORDER BY e.seq) AS rn
                  FROM events e
                 WHERE e.event_type = 'ItemAdded')
         WHERE rn = 1 AND n > 0) a
 WHERE order_lines.order_item_id = a.id;
