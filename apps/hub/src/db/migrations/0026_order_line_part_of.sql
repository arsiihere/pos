-- 02b v1.0.20 §5 (owner 2026-11-22, STAB-5 phase 1): order_lines.part_of = the line's ItemAdded.part_of, the first part's
-- order_item_id of a line sent as one-unit parts (§3.2 step 4a); NULL = not split. No stored event carries part_of
-- (it is new), so there is nothing to refold and every existing row keeps NULL. Earlier migrations are never edited.
ALTER TABLE order_lines ADD COLUMN part_of TEXT;
