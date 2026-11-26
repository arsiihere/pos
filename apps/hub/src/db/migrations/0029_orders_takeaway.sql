-- 02b v1.0.25 §5 (02b-TK R1, R3, R4, R9; run 2 R2-M-6; run 3 R3-B-2, R3-M-1, R3-M-8; verify V-04, R3-M-8): the
-- takeaway and approval columns, the group tracking cutoff and three indexes. The `orders` checkpoint is deleted, so
-- the next boot resets `orders` and refolds it from seq 0 (00 v1.10 H-2; the 0019 / 0020 / 0021 pattern; no UPDATE).

-- OrderPlaced.pickup_at_ms (takeaway only, §3.2 step 2b); NULL = no pickup
ALTER TABLE orders ADD COLUMN pickup_at_ms INTEGER;
-- OrderBoosted on a pickup order (the time is kept, §3.8 / D1)
ALTER TABLE orders ADD COLUMN pickup_boosted INTEGER NOT NULL DEFAULT 0 CHECK (pickup_boosted IN (0,1));
-- phoneKey(phone) in the OrderContactSet fold (§3.1); NULL when phone is NULL; never leaves the hub
ALTER TABLE orders ADD COLUMN phone_key TEXT;
-- UnpaidHandoverApproved for this named order and its approved due (§3.7a, §6.19); NULL = no effective approval
ALTER TABLE orders ADD COLUMN unpaid_handover_approved_at INTEGER;
ALTER TABLE orders ADD COLUMN unpaid_handover_approved_due_minor INTEGER;
-- the takeaway group's tracking cutoff, on the group root (§6.19); NULL until set
ALTER TABLE orders ADD COLUMN tracking_close_cutoff_ms INTEGER;

-- ItemAdded refs: an option_child's option, a deal_part's part, the plain options as [{ option_id, quantity }]
ALTER TABLE order_lines ADD COLUMN option_id TEXT;
ALTER TABLE order_lines ADD COLUMN deal_part_id TEXT;
ALTER TABLE order_lines ADD COLUMN option_refs_json TEXT;

-- paid takeaways not yet handed over (§3.3 Open (lists)): the second branch of openOrderRows
CREATE INDEX orders_open_takeaway_paid ON orders (placed_at)
  WHERE order_type = 'takeaway' AND billed_at IS NOT NULL AND cancelled_at IS NULL AND day_closed_at IS NULL;
-- customer-orders (§6.18b)
CREATE INDEX orders_phone ON orders (phone_key, placed_at) WHERE phone_key IS NOT NULL;
-- top-items window (§6.18c)
CREATE INDEX orders_placed ON orders (placed_at);

DELETE FROM projection_checkpoints WHERE projection = 'orders';
