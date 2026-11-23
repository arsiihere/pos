# 08a — Urdu to do

Every 08a §8 owner-app string (stock items by kind, Menu cost, the item page, the §9 reason texts). No Urdu frame exists for 08a yet; until one is drawn these show in English (a key missing from `ur.ts` falls back to `en.ts`). I12: "Menu cost" and "Today's cost" must stay two different words in Urdu too. `errors.reference.wrong_kind` has a draft Urdu text in `ur.ts` (the item form is an Urdu-checked page); it still needs the native read.

| Key | English |
|---|---|
| `stock_items.tab_label` | Kind of stock |
| `stock_items.tab_prepared` | Prepared |
| `stock_items.tab_ingredient` | Ingredients |
| `stock_items.tab_packet` | Packets |
| `stock_items.col_08a_code` | Code |
| `stock_items.col_08a_cost` | Menu cost |
| `stock_items.col_08a_cost_for` | Menu cost for |
| `stock_items.col_08a_empty_kind` | No {kind} yet |
| `stock_item.f08a_kind` | Kind |
| `stock_item.f08a_kind_help` | Only prepared stock is counted at a station and used by dishes. |
| `stock_item.f08a_code` | Code |
| `stock_item.f08a_code_help` | Optional, e.g. TP-1. |
| `stock_item.f08a_code_invalid` | Up to 16 letters, digits or dashes, e.g. TP-1. |
| `stock_item.f08a_cost_category` | Cost category |
| `stock_item.f08a_cost_food` | Food |
| `stock_item.f08a_cost_packaging` | Packaging |
| `stock_item.f08a_cost_cleaning` | Cleaning |
| `stock_item.f08a_cost_beverage` | Beverage |
| `stock_item.f08a_a_item` | A-item (costly, watched closely) |
| `stock_item.f08a_packet_g` | A packet is always counted in g. |
| `stock_item.f08a_kind_branches` | Counted at {names}. Stop counting it there first, then change the kind. |
| `stock_item.f08a_kind_dishes` | Used by {names}. Remove it from these dishes first, then change the kind. |
| `stock_item.f08a_open_page` | Units, menu cost and yield |
| `stock_inv.kind_prepared` | Prepared |
| `stock_inv.kind_ingredient` | Ingredient |
| `stock_inv.kind_packet` | Packet |
| `stock_inv.a_item` | A-item |
| `stock_inv.facts` | {kind} · counted in {unit} |
| `stock_inv.code` | Code {code} |
| `stock_inv.edit_details` | Edit details |
| `stock_inv.open_named` | Units and menu cost for {name} |
| `stock_inv.every_branch` | Every branch |
| `stock_inv.by_when` | {who} · {when} |
| `stock_inv.note` | Note (optional) |
| `stock_inv.other_unit` | other unit |
| `stock_inv.unit_sentence` | 1 {name} = {amount} |
| `stock_inv.units_title` | Units |
| `stock_inv.units_help` | Each unit is a fixed amount of {unit}. Prices and recipes may use any of these. |
| `stock_inv.builtin_title` | Built in |
| `stock_inv.item_units_title` | Units of this item |
| `stock_inv.no_units` | No units of its own yet. |
| `stock_inv.add_unit` | Add or change a unit |
| `stock_inv.unit_history` | Unit history |
| `stock_inv.unit_name` | Unit name |
| `stock_inv.unit_name_help` | e.g. peti, tray, piece. A name already here gets the new size. |
| `stock_inv.unit_amount` | 1 unit is |
| `stock_inv.unit_in` | In |
| `stock_inv.unit_name_invalid` | Type a name of up to 20 letters, digits, spaces, dots, dashes or _. |
| `stock_inv.unit_known` | {name} is already known for this item. Use another name. |
| `stock_inv.unit_amount_invalid` | Type an amount above 0, up to 1,000,000,000 {unit} and 6 decimals. |
| `stock_inv.save_unit` | Save unit |
| `stock_inv.menu_cost_title` | Menu cost |
| `stock_inv.menu_cost_help` | Price you set. Today's cost from deliveries is on the hub (coming) |
| `stock_inv.menu_cost_at` | At {branch} |
| `stock_inv.menu_cost_every` | For every branch |
| `stock_inv.no_price` | No price |
| `stock_inv.cost_per` | Rs {amount} / {unit} |
| `stock_inv.cost_below` | < Rs {amount} / {unit} |
| `stock_inv.set_price` | Set price |
| `stock_inv.price_kind` | Price type |
| `stock_inv.kind_manual` | Manual |
| `stock_inv.kind_market` | Today's market rate |
| `stock_inv.manual_help` | For every branch, until you set another price. |
| `stock_inv.market_help` | Beats the manual price while it is valid. |
| `stock_inv.price_branch` | For |
| `stock_inv.valid_for` | Valid for |
| `stock_inv.valid_1d` | 1 day |
| `stock_inv.valid_2d` | 2 days |
| `stock_inv.valid_1w` | 1 week |
| `stock_inv.valid_custom` | Custom |
| `stock_inv.valid_hours` | Hours |
| `stock_inv.valid_hours_invalid` | Type whole hours from 1 to 720. |
| `stock_inv.price_unit` | Price per |
| `stock_inv.price_amount` | Amount |
| `stock_inv.price_invalid` | Type a price from Rs 0.01 to Rs 10,000,000. |
| `stock_inv.save_price` | Save price |
| `stock_inv.price_history` | Price history |
| `stock_inv.no_prices` | No price set yet. |
| `stock_inv.price_row` | Rs {amount} per {unit} |
| `stock_inv.valid_until` | until {when} |
| `stock_inv.yield_title` | Yield |
| `stock_inv.yield_help` | How much is left to cook with after cleaning and trimming. |
| `stock_inv.no_yield` | No yield yet. |
| `stock_inv.yield_pct` | {pct} % |
| `stock_inv.record_test` | Record a test |
| `stock_inv.set_yield` | Set yield % |
| `stock_inv.test_ap` | Before cleaning (AP) |
| `stock_inv.test_ep` | After cleaning (EP) |
| `stock_inv.test_invalid` | Type both amounts, above 0. |
| `stock_inv.yield_pct_label` | Yield % |
| `stock_inv.yield_invalid` | Type a yield from 0.01 % to 500 %. |
| `stock_inv.save_yield` | Save yield |
| `stock_inv.yield_test_row` | Test: {ap} → {ep} |
| `stock_inv.yield_history` | Yield history |
| `stock_inv.wrong_kind_yield` | Only an ingredient has a yield. Reload the page. |
| `errors.reference.wrong_kind` | Only prepared stock can be used here. This one is an ingredient or a packet. |
| `errors.reference.packet_unit` | A packet is counted in g. Change Counted in to g. |
| `errors.reference.not_convertible` | This unit can't be turned into the stock unit. Add the unit under Units first. |
| `errors.reference.branch_not_found` | This branch isn't here any more. Pick another branch. |
| `errors.CONFIG_NAME_TAKEN_stock_item_code` | Another stock item already has this code. Choose another code. |
