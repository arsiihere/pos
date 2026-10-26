-- 01a S57 (v1.2): a branch may sell an item at its own price. NULL = the item's price_minor (same range).
-- Existing routes read NULL, so no backfill.
ALTER TABLE item_routes
  ADD COLUMN price_minor_override BIGINT CHECK (price_minor_override BETWEEN 0 AND 1000000000);
