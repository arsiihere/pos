# 08b — Urdu to do

Every 08b §8 owner-app string (the Recipes page, the recipe editor, the menu page's "No recipe" badge, the B17 refusal text in the 01c / 08a forms). No Urdu frame exists for 08b yet; until one is drawn these show in English (a key missing from `ur.ts` falls back to `en.ts`). `owner.nav.recipes` and `menu.no_recipe` have a draft Urdu text in `ur.ts` (the nav and the menu page are Urdu-checked pages); they still need the native read. I12: "Menu cost" / "Plate cost (menu cost)" must never read as "today's cost" in Urdu either.

| Key | English |
|---|---|
| `owner.nav.recipes` | Recipes |
| `menu.no_recipe` | No recipe |
| `recipes.title` | Recipes |
| `recipes.coverage` | {n} of {m} items have a recipe — {pct} % |
| `recipes.help` | Plate cost uses the menu cost of each stock item: the prices you set. |
| `recipes.filter_label` | Show |
| `recipes.filter_all` | All |
| `recipes.filter_missing` | Missing |
| `recipes.filter_partial` | Partial |
| `recipes.group_menu_item` | Menu items |
| `recipes.group_modifier_option` | Options |
| `recipes.group_stock_item` | Prepared |
| `recipes.col_owner` | Item |
| `recipes.col_status` | Recipe |
| `recipes.col_cost` | Plate cost (menu cost) |
| `recipes.cost_rs` | Rs {amount} |
| `recipes.cost_partial` | {cost} · partial |
| `recipes.cost_none_partial` | No cost yet · partial |
| `recipes.cost_none` | No cost yet |
| `recipes.no_recipe` | No recipe |
| `recipes.published_v` | Version {n} |
| `recipes.draft` | Draft |
| `recipes.archived` | Archived |
| `recipes.owner_archived` | Item archived |
| `recipes.create` | Create recipe |
| `recipes.open_named` | Open the recipe for {name} |
| `recipes.empty` | Nothing to show here |
| `recipes.restore` | Restore |
| `recipes.restore_refused` | This old version can't come back: {reason} |
| `recipes.new_version` | Make a new recipe version |
| `recipes.missing_cost` | Missing cost: {names} |
| `recipes.missing_unnamed` | an archived stock item |
| `recipes.stale_reloaded` | Someone changed this recipe elsewhere. The list is read again; try once more. |
| `recipes.restore_reason.basis_mismatch` | the item is now sold another way (by piece, weight or volume) |
| `recipes.restore_reason.unit_changed` | a stock item it uses, or the item itself, is now counted in another unit |
| `recipe.hint_no_yield` | Default: AP — no yield |
| `recipe.title` | Recipe |
| `recipe.back_label` | Back to recipes |
| `recipe.gone_title` | This recipe is not here any more |
| `recipe.owner_menu_item` | Menu item |
| `recipe.owner_modifier_option` | Option |
| `recipe.owner_stock_item` | Prepared stock |
| `recipe.archived_note` | This recipe is archived. Publish a new version or restore it to use it again. |
| `recipe.owner_archived_note` | The item this recipe is for is archived. |
| `recipe.basis_title` | Recipe is for |
| `recipe.per_piece` | One piece sold |
| `recipe.per_option` | One of this option |
| `recipe.per_kg` | per kg |
| `recipe.per_litre` | per litre |
| `recipe.per_base` | per {qty} {unit} |
| `recipe.base_qty` | Amount sold, in {unit} |
| `recipe.base_qty_invalid` | Type a whole amount from 1 to 1,000,000. |
| `recipe.batch_yield` | One batch makes |
| `recipe.batch_yield_invalid` | Type a whole number from 1 to 1,000,000,000. |
| `recipe.makes` | makes {qty} {unit} |
| `recipe.misc` | Misc allowance % |
| `recipe.misc_help` | Added on top for oil, salt and spices you do not list. Usually 5 %. |
| `recipe.misc_help_batch` | Not added when this batch is used in a dish; the dish adds its own. |
| `recipe.misc_invalid` | Type a percent from 0 to 50. |
| `recipe.lines_title` | Ingredients |
| `recipe.lines_help` | Any stock item: ingredients, packets or prepared stock. |
| `recipe.no_lines` | No ingredients yet. |
| `recipe.col_item` | Stock item |
| `recipe.col_qty` | Amount |
| `recipe.col_unit` | Unit |
| `recipe.col_basis` | AP / EP |
| `recipe.col_line_cost` | Line cost (menu cost) |
| `recipe.qty_named` | Amount of {name} |
| `recipe.unit_named` | Unit of {name} |
| `recipe.basis_named` | AP or EP for {name} |
| `recipe.basis_default` | Default: {basis} |
| `recipe.basis_default_unknown` | Default |
| `recipe.basis_ap` | AP (as bought) |
| `recipe.basis_ep` | EP (after cleaning) |
| `recipe.qty_invalid` | Type an amount like 250 or 0.25 (not 0, up to 4 decimals). |
| `recipe.remove_line` | Remove {name} |
| `recipe.add_line` | Add a stock item |
| `recipe.search` | Search stock items |
| `recipe.cost_on_save` | Shown after Save draft |
| `recipe.plate_cost` | Plate cost (menu cost) |
| `recipe.batch_cost` | Batch cost (menu cost) |
| `recipe.cost_help` | From the menu cost of each line, for the branch picked above. |
| `recipe.warnings` | Check these |
| `recipe.warn.ep_in_batch` | {line}: a batch recipe uses amounts as bought (AP). |
| `recipe.warn.no_yield_defaulted_ap` | {line}: no yield yet, so the amount is taken as bought (AP). |
| `recipe.warn.ep_no_yield` | {line}: EP needs a yield. Record one, or the cost stays partial. |
| `recipe.warn.no_menu_cost` | {line}: no menu cost yet, so the plate cost is partial. |
| `recipe.warn.main_line_off` | No main ingredient line is near the recipe amount. Check the amounts. |
| `recipe.save_draft` | Save draft |
| `recipe.publish` | Publish |
| `recipe.archive` | Archive |
| `recipe.restore` | Restore |
| `recipe.draft_saved` | Draft saved |
| `recipe.published` | Published. Branches get it with the next menu update. |
| `recipe.new_version_help` | Change the draft below, then Save draft and Publish. |
| `recipe.history` | History |
| `recipe.history_row` | Version {n} · {status} |
| `recipe.status_draft` | Draft |
| `recipe.status_published` | Published |
| `recipe.status_superseded` | Replaced |
| `recipe.reason.not_found` | This no longer exists. Reload the page. |
| `recipe.reason.archived` | This stock item was archived. Remove the line or pick another one. |
| `recipe.reason.linked_option` | This option is a menu item now; it is costed by that item’s recipe. |
| `recipe.reason.wrong_kind` | Only prepared stock has a recipe; ingredients and packets are costed by their price. |
| `recipe.reason.basis_mismatch` | The item is now sold another way (by piece, weight or volume). Save the draft again. |
| `recipe.reason.negative_not_option` | Only an option recipe can take an amount away (a minus amount). |
| `recipe.reason.not_convertible` | This unit can't be turned into the stock unit. Add the unit on the stock item first. |
| `recipe.reason.qty_out_of_range` | This amount is too big. Use a smaller amount or a bigger unit. |
| `recipe.reason.batch_yield_missing` | Say how much one batch makes. |
| `recipe.reason.unit_changed` | A stock item is now counted in another unit. Save the draft again. |
| `recipe.reason.cycle` | This would make a recipe use itself (through another prepared item). |
| `recipe.reason.too_deep` | Prepared items inside prepared items go at most 3 levels deep. |
| `recipe.reason.empty` | Add at least one ingredient. |
| `recipe_in_use.text` | A recipe uses this — archive the recipe first, then try again. |
| `recipe_in_use.open` | Open recipe |
