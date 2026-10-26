# 01a — Urdu still to translate

Keys in `apps/client/src/i18n/en.ts` with no entry in `ur.ts` (S49). They show in English on an Urdu page until translated. Generated after hand-off phase 2; phase 3 adds the stock page keys.

376 keys.

| Key | English |
|---|---|
| `admin_stock.title` | Stock |
| `admin_stock.login.title` | Sign in to manage stock |
| `admin_stock.login.pick` | Tap your name, then type your PIN. |
| `admin_stock.login.loading` | Loading the staff list… |
| `admin_stock.login.no_admins` | No one on the staff list can open this page. Ask the owner. |
| `admin_stock.errors.network` | The hub cannot be reached. Check the Wi-Fi; what you typed is kept. |
| `admin_stock.errors.PERMISSION_DENIED` | You do not have permission for this. Ask a manager. |
| `admin_stock.status.version` | Menu version {version} |
| `admin_stock.status.no_menu` | No menu yet |
| `admin_stock.status.checked` |  · checked {minutes} min ago |
| `admin_stock.status.checked_now` |  · checked just now |
| `admin_stock.status.offline` |  · offline |
| `admin_stock.status.waiting` | Waiting for hub confirmation |
| `admin_stock.problem.rejected` | Menu update refused ({reason}). |
| `admin_stock.problem.apply_failed` | Menu update could not be applied. |
| `admin_stock.problem.still_using` |  The hub is still using version {version}. |
| `admin_stock.problem.no_menu` |  The hub has no menu yet. |
| `admin_stock.problem.unauthorized` | The hub's cloud key was refused. Call support. |
| `admin_stock.reconnecting` | Reconnecting to the hub… What you typed is kept. |
| `admin_stock.alert.low` | Low: {items} |
| `admin_stock.alert.out` | Out: {items} |
| `admin_stock.search` | Search items |
| `admin_stock.category` | Category |
| `admin_stock.all_categories` | All categories |
| `admin_stock.empty` | No items in the menu yet. |
| `admin_stock.on_hand` | On hand |
| `admin_stock.confirm` | Confirm |
| `admin_stock.reserved` | Reserved |
| `admin_stock.available_label` | Available |
| `admin_stock.set_at` | Set at {time} |
| `admin_stock.sold_out_when_0` | Sold out when 0 |
| `admin_stock.available` | Available |
| `admin_stock.off` | Off |
| `admin_stock.badge.not_counted` | Not counted today |
| `admin_stock.badge.hours` | Hours {hours} |
| `admin_stock.badge.off_since` | Off since {day} |
| `admin_stock.save` | Save counts |
| `admin_stock.saved` | Counts saved. |
| `admin_stock.nothing_to_save` | Change or confirm a count first. |
| `admin_stock.add_label` | Add |
| `admin_stock.add` | Add |
| `admin_stock.day.open` | Day open: {day} since {time} ({hours} h) |
| `admin_stock.day.closed` | Day closed at {time} |
| `admin_stock.day.close` | Close day |
| `admin_stock.day.close_confirm` | Close the business day? Counts of items that do not keep overnight will read 0 until the next day is started |
| `admin_stock.day.cancel` | Cancel |
| `admin_stock.day.opened_recently` | This day was started less than {hours} h ago; nothing changed. |
| `admin_stock.day.start` | Start day |
| `admin_stock.day.none_open` | No business day is open. Start the day, then enter the counts. |
| `admin_stock.day.retry_needs_day` | The business day is not open, so this was not saved. Start the day to save it. |
| `admin_stock.stale.text` | Yesterday's day is still open since {time}. Close it and start a new day? |
| `admin_stock.stale.close_and_start` | Close and start new day |
| `admin_stock.stale.keep` | Keep this day open |
| `common.loading` | Loading… |
| `common.saved` | Saved |
| `common.undo` | Undo |
| `common.cancel` | Cancel |
| `archive.archived` | Archived |
| `staff.locked` | Locked |
| `staff.locked_for` | Locked · {n} min |
| `common.slow` | Still working. This can take a few seconds. |
| `pin.label` | PIN |
| `pin.delete` | Delete |
| `pin.submit` | Enter |
| `quantity.pieces` | pieces |
| `quantity.kg` | kg |
| `quantity.l` | L |
| `quantity.invalid` | Check the number: whole pieces, or kg and L with up to 3 decimals. |
| `owner.nav.floors_short` | Floors |
| `owner.nav.stations_short` | Stations |
| `owner.nav.label` | Sections |
| `owner.branch` | Branch |
| `owner.branch_title` | Which branch are you setting up? |
| `owner.branch_body` | Floors, tables and kitchen stations belong to one branch. You can switch any time from the top of the page. |
| `owner.branch_ids_note` | Branch names show once they are set in Branch settings. Until then the end of each branch's ID shows. |
| `owner.menu_shared_title` | Menu is the same for every branch |
| `owner.menu_shared_body` | Items, categories, prices and tax need no branch. |
| `owner.open_menu` | Open the menu |
| `owner.continue_with` | Continue with {branch} |
| `common.and` | and |
| `common.close` | Close |
| `common.cloud_down` | Can't reach the restaurant cloud — retrying… |
| `common.cloud_down_body` | Your changes stay on this page. Save works again when the internet is back. |
| `discard.title` | Discard your changes to {name}? |
| `discard.body` | You changed {fields}. They are not saved yet. |
| `discard.keep` | Keep editing |
| `discard.discard` | Discard changes |
| `archive.item_title` | Archive {name}? |
| `archive.archive_name` | Archive {name} |
| `archive.blocked_title` | {name} can't be archived yet |
| `archive.floor_body` | Waiters can't pick it any more. You can restore it from Show archived. |
| `archive.floor_blocked_body` | It still has {n} tables in use. Move them to another floor or archive them first. |
| `archive.floor_tables_then_floor` | Archive all {n} tables, then the floor |
| `owner.floors.seats_n` | {n} seats |
| `floors.summary` | {tables} tables · {seats} seats |
| `floors.archived_on` | Archived {date} · {n} tables · waiters can't pick it |
| `floors.first_title` | Add your first floor |
| `floors.first_body` | Name the floor, then add its tables in one go. You can rename or add more later. |
| `floors.first_table` | First table |
| `floors.last_table` | Last table |
| `floors.seats_per_table` | Seats per table (optional) |
| `floors.seats_help` | Leave empty if it varies. |
| `floors.parking_note` | Parking is not a table; it has its own order type. |
| `floors.add_floor_and_tables` | Add floor and {n} tables |
| `floors.adding_progress` | Adding {i} of {n}… |
| `floors.add_n_tables` | Add {n} tables |
| `floors.adds_n` | Adds {n} tables: {list}, {seats} seats each. |
| `floors.adds_n_no_seats` | Adds {n} tables: {list}. |
| `floors.names_taken` | {names} already used at {branch}. Pick other numbers. |
| `floors.stopped_at` | Stopped at {name}: {reason} The tables before it were added. |
| `floors.range_invalid` | Use one prefix and up to 100 numbers, like T1 to T12. |
| `floors.from` | From |
| `floors.to` | To |
| `floors.seats_each` | Seats each |
| `floors.rename` | Rename |
| `floors.done` | Done |
| `floors.position` | Position |
| `floors.position_help` | 1 shows first on the floor. |
| `floors.add_tables` | Add tables |
| `floors.edit_table` | Edit table {name} |
| `floors.save_table` | Save table |
| `floors.table_name` | Table name |
| `floors.table_name_help` | What waiters tap. Short is best. |
| `floors.seats` | Seats |
| `floors.floor` | Floor |
| `floors.archive_table` | Archive this table |
| `floors.archive_table_body` | Waiters can't pick it. An open order on it can still be billed. |
| `errors.CONFIG_NAME_TAKEN_table` | {name} is already used at {branch}. Pick another name. |
| `owner.login.title` | Sign in |
| `owner.login.brand` | POS |
| `owner.login.headline` | Set up your restaurant once. Every branch follows. |
| `owner.login.line` | Menu, prices, kitchen stations and tables. Changes reach each branch within a minute. |
| `owner.login.caption` | Restaurant setup · owners only |
| `owner.login.body` | Use the owner email you registered with. |
| `owner.login.show` | Show |
| `owner.login.hide` | Hide |
| `owner.login.signing_in` | Signing in… |
| `owner.login.need_email` | Enter your email. |
| `owner.login.need_password` | Enter your password. |
| `owner.login.invalid_body` | Check both and try again. |
| `owner.login.cloud_down` | Can't reach the restaurant cloud. |
| `owner.login.cloud_down_body` | Check the internet. What you typed is kept; tap Sign in again. |
| `owner.login.email` | Email |
| `owner.login.password` | Password |
| `owner.login.submit` | Sign in |
| `owner.common.show_archived` | Show archived |
| `owner.common.archive` | Archive |
| `owner.common.restore` | Restore |
| `owner.common.archived` | Archived |
| `owner.common.cancel` | Cancel |
| `owner.floors.title` | Floors and tables |
| `owner.floors.floor_name` | Floor name |
| `owner.floors.add_floor` | Add floor |
| `owner.stations.title` | Stations |
| `owner.stations.station_name` | Station name |
| `owner.stations.location_label` | Where it is (optional) |
| `owner.stations.type` | How it cooks |
| `owner.stations.type_slot` | One order at a time |
| `owner.stations.type_batch` | In batches |
| `owner.stations.capacity` | How many at once |
| `owner.stations.capacity_batch` | Batches at the same time |
| `owner.stations.freshness_minutes` | A cooked batch stays fresh for (min) |
| `owner.stations.freshness_help` | After that it is not served from this batch. 0 = no limit. |
| `owner.stations.completion_mode` | Cook marks it done by |
| `owner.stations.mode_two_tap` | Start + Done taps |
| `owner.stations.mode_two_tap_short` | cook taps Start and Done |
| `owner.stations.mode_single_tap` | One Done tap |
| `owner.stations.mode_single_tap_short` | one Done tap |
| `owner.stations.mode_auto_done` | Itself, when the time is up |
| `owner.stations.mode_auto_done_short` | done when the time is up |
| `owner.stations.add_station` | Add station |
| `owner.stations.programs` | Batch recipes |
| `owner.stations.programs_body` | A fixed cook for a whole pot. |
| `owner.stations.minutes_n` | {n} min |
| `owner.stations.cooks_each` | cooks each order |
| `owner.stations.cooks_batches` | cooks in batches |
| `owner.stations.at_a_time` | {n} at a time |
| `owner.stations.type_locked` | Can't change while items use this station. |
| `owner.stations.new_station_title` | Add a kitchen station |
| `owner.stations.new_station_body` | A station is a place where food is cooked: a tandoor, a karahi counter, a degh, a fryer. |
| `owner.stations.new_program_title` | New batch recipe |
| `owner.stations.new_program_for` | New batch recipe for {name} |
| `owner.stations.program_body` | One fixed cook for a whole pot. Items pick a recipe when they are cooked here. |
| `owner.stations.cook_help` | Up to 4 hours. |
| `owner.stations.save_program` | Save recipe |
| `owner.stations.archive_program` | Archive this recipe |
| `owner.stations.archive_station` | Archive this station |
| `owner.stations.save_station` | Save station |
| `owner.stations.field.name` | the name |
| `owner.stations.field.location_label` | where it is |
| `owner.stations.field.station_type` | how it cooks |
| `owner.stations.field.capacity` | how many at once |
| `owner.stations.field.freshness_window_ms` | the freshness time |
| `owner.stations.field.completion_mode` | how it is marked done |
| `archive.station_body` | Cooks at this branch stop seeing it. You can restore it from Show archived. |
| `archive.station_type_blocked` | The cooking type can't change while items use {name} |
| `archive.station_blocked_body` | {n} items are cooked here. Move them to another station or mark them Not sold here at {branch} first. |
| `archive.open_items` | Open these items |
| `archive.and_more` | and {n} more |
| `owner.stations.program_name` | Recipe name |
| `owner.stations.cook_minutes` | Cooking time (min) |
| `owner.stations.add_program` | Add recipe |
| `owner.menu.read_only` | You can see the menu but not change it. |
| `owner.menu.new_tax_class` | New tax rate name |
| `owner.menu.rate_percent` | Rate |
| `owner.menu.add_tax_class` | Add tax rate |
| `owner.menu.search` | Search items |
| `owner.menu.category_filter` | Category |
| `owner.menu.all_categories` | All categories |
| `owner.menu.status` | Show |
| `owner.menu.status_active` | Active |
| `owner.menu.status_archived` | Archived |
| `owner.menu.rupees` | Rs |
| `owner.menu.load_more` | Load more |
| `owner.menu.new_category` | New category |
| `owner.category.new` | New category |
| `owner.category.edit` | Edit category |
| `owner.category.name` | Category name |
| `owner.item.new` | New item |
| `owner.item.edit` | Edit item |
| `owner.item.name` | Item name |
| `owner.item.group_label` | Group with other sizes (optional) |
| `owner.item.description` | Short description (optional) |
| `owner.item.tax_class` | Tax |
| `owner.item.no_tax` | No tax |
| `owner.item.price` | Price |
| `owner.item.serve_mode` | Serve |
| `owner.item.serve_immediate` | When ready |
| `owner.item.serve_sync` | With the table |
| `owner.item.cook_minutes` | Cooking time (min) |
| `owner.item.prep_minutes` | Extra time to plate (min) |
| `owner.item.stock_time_minutes` | Serve from stock in (min) |
| `owner.item.out_of_stock` | When pre-cooked stock runs out |
| `owner.item.cook_fresh` | Cook fresh |
| `owner.item.sold_out` | Sold out |
| `owner.item.stock_unit` | Stock unit |
| `owner.item.sale_unit` | Sold by |
| `owner.item.unit_piece` | Pieces |
| `owner.item.unit_g` | Grams (shown as kg) |
| `owner.item.unit_ml` | Millilitres (shown as L) |
| `owner.item.per_piece_g` | Grams per piece |
| `owner.item.per_piece_ml` | Millilitres per piece |
| `owner.item.unit_change_warning` | Takes effect when the next business day starts; that day needs a new count of this item at every branch. |
| `owner.item.low_stock` | Low stock alert at (empty = none) |
| `owner.item.carries_over` | Keeps overnight |
| `owner.item.station` | Station |
| `owner.item.not_sold_here` | Not sold here |
| `owner.item.program` | Batch recipe |
| `owner.item.stock_program` | Pre-cooked batch recipe |
| `owner.item.no_stock_program` | None |
| `owner.hours.label` | Available hours |
| `owner.hours.always` | Always available |
| `owner.hours.from` | From |
| `owner.hours.to` | To |
| `owner.hours.remove` | Remove |
| `owner.hours.equal` | From and To must be different. |
| `owner.hours.invalid` | Enter times as HH:MM. |
| `menu.per.l` | / L |
| `menu.read_only_body` | Only an owner of every branch can change the shared menu. |
| `menu.section` | Section |
| `menu.no_items` | No items here |
| `menu.no_match` | No items match “{q}” |
| `menu.no_match_body` | Check the spelling, or look in Archived. |
| `menu.clear_search` | Clear search |
| `menu.show_archived` | Show archived |
| `menu.group_n` | Group: {name} |
| `menu.sold_out_when_gone` | Sold out when gone |
| `menu.view` | View |
| `menu.cats_order_help` | Order sets where the category shows on the order screen. 1 shows first. |
| `menu.tax_default` | Default for new items |
| `menu.new_tax` | New tax rate |
| `menu.first.title` | Welcome, let's set up your restaurant |
| `menu.first.body` | Five steps. You can come back to any of them later. Each branch gets the changes within a minute. |
| `menu.first.stations` | Where food is cooked at each branch: tandoor, karahi counter, degh. |
| `menu.first.floors` | The tables waiters pick, floor by floor. |
| `menu.first.categories` | Groups on the order screen, like Breakfast, Karahi, Breads, Drinks. |
| `menu.first.add_categories` | Add categories |
| `menu.first.tax_title` | Tax rates (optional) |
| `menu.first.tax` | Skip if you don't charge tax. \"No tax\" is the default. |
| `menu.first.add` | Add |
| `menu.first.items` | Needs at least one category. |
| `menu.first.add_items` | Add items |
| `tax.edit` | Edit tax rate |
| `tax.save` | Save tax rate |
| `tax.name` | Name |
| `tax.name_help` | Staff see this on the bill. |
| `tax.rate` | Rate |
| `tax.rate_help` | Up to 2 decimals, e.g. 16 or 7.5. |
| `tax.applies_note` | The new rate applies to every bill closed after you save, including tables that are open now. |
| `tax.archive_title` | Archive this tax rate |
| `archive.item_body` | It disappears from ordering at every branch within a minute. Past orders and reports keep it. You can restore it from Archived. |
| `archive.category_body` | It stops showing on the order screen at every branch. You can restore it from Archived. |
| `archive.tax_body` | New items can no longer pick it. You can restore it from Archived. |
| `archive.in_use_body` | {n} items still use it. Move them to another one or archive them first. |
| `owner.category.position` | Position |
| `owner.category.position_help` | 1 shows first when ordering. |
| `owner.category.hours_note` | Every item in {name} follows these hours. An item can narrow them further, never widen them. |
| `owner.category.this` | this category |
| `owner.category.save` | Save category |
| `owner.hours.all_day` | All day |
| `owner.hours.set_hours` | Only at set hours |
| `owner.hours.add_n` | Add hours ({n} more allowed) |
| `owner.hours.wraps` | {hours} runs past midnight |
| `owner.hours.overlap` | Can be ordered {hours} (item and category overlap) |
| `owner.hours.category_none` | The category's hours also apply. {name} has none. |
| `owner.hours.category_has` | The category's hours also apply. {name}: {hours}. |
| `item.per_piece` | per piece |
| `item.per_kg` | per kg |
| `item.per_l` | per L |
| `item.section.customers` | What customers see |
| `item.section.price` | Price |
| `item.section.kitchen` | Kitchen |
| `item.section.stock` | Ready-made stock |
| `item.section.hours` | Hours |
| `item.need_name` | Enter a name, up to 60 letters. |
| `item.need_price` | Enter the price in rupees, like 1,200. |
| `item.need_cook` | Enter a cooking time from 1 minute to 4 hours. |
| `item.need_prep` | Enter minutes, or leave it empty. |
| `item.stock_time_long` | Must be shorter than the cooking time ({n} min). |
| `item.need_per` | Enter a whole number. |
| `item.changed.price` | the price |
| `item.changed.cook` | the cooking time |
| `item.changed.name` | the name |
| `item.changed.other` | other details |
| `item.changed.kitchen` | the kitchen |
| `item.fix_n` | {n} things to fix before saving |
| `item.partial` | Item saved. One branch was not. |
| `item.partial_body` | {branch}: {reason} Pick another station or Not sold here, then save again. |
| `item.save_branch_again` | Save {branch} again |
| `item.need_category` | Add a category first. |
| `item.add` | Add item |
| `item.save` | Save item |
| `item.price_was` | Was Rs {old}. Open orders keep the old price. |
| `item.cook_n` | Cooks {n} min |
| `item.reach_branches` | Each branch gets the new price within a minute. |
| `item.save_price` | Save price |
| `item.group_help` | Half and Full show side by side when ordering. |
| `item.kitchen_body` | Which station cooks it at each branch, and how long it takes. |
| `item.no_recipe_needed` | Cooks each order · no recipe needed |
| `item.stock_body` | For food cooked in advance and counted each morning. |
| `item.kept_ready` | Kept ready |
| `item.conversion` | {n} plates use {counted}. |
| `item.no_conversion` | Sold by kg and counted in kg: no conversion needed. Half kg sells as 0.5. |
| `item.archive_title` | Archive this item |
| `item.archive_body` | It disappears from ordering. Past orders keep it. |
| `item.archive` | Archive item |
| `item.preview` | How staff will see it |
| `item.warns_below` | Warns below {n} |
| `errors.CONFIG_NAME_TAKEN` | That name is already used. Choose another name. |
| `errors.CONFIG_IN_USE` | Still in use. Archive or move what uses it first. |
| `errors.CONFIG_REFERENCE_INVALID` | Something it points to is archived or missing. Choose another one. |
| `errors.PERMISSION_DENIED` | Only an owner of every branch can change this. |
| `errors.LOGIN_INVALID` | Email or password is wrong |
| `errors.LOGIN_LOCKED_OUT` | Too many tries. Wait a few minutes, then try again. |
| `errors.IP_LOCKED_OUT` | Too many tries. Wait a few minutes, then try again. |
| `errors.IDEMPOTENCY_KEY_MISMATCH` | This form was already saved with other values. The list is reloaded; check it before adding again. |
| `errors.VALIDATION_FAILED` | Check the fields and try again. |
| `errors.PIN_INVALID` | Wrong PIN. Try again. |
| `errors.PIN_LOCKED_OUT` | Too many wrong PINs. Wait, then try again. |
| `errors.DEVICE_LOCKED_OUT` | Too many wrong PINs on this screen. Wait, then try again. |
| `errors.ADMIN_SESSION_REQUIRED` | You were signed out. Sign in again. |
| `errors.DEVICE_TOKEN_INVALID` | This screen must be paired again. |
| `errors.DEVICE_REVOKED` | This screen must be paired again. |
| `errors.DEVICE_TYPE_NOT_ALLOWED` | This kind of screen cannot do that. |
| `errors.DEVICE_NOT_OWNED` | This phone belongs to someone else. |
| `errors.HUB_NOT_PROVISIONED` | The hub is being set up. |
| `errors.reference.archived` | This was archived. Pick another one. |
| `errors.reference.not_found` | This no longer exists. Pick another one. |
| `errors.reference.wrong_branch` | This station belongs to another branch. |
| `errors.reference.program_required` | Choose a batch recipe. |
| `errors.reference.program_not_allowed` | This station cooks each order; it takes no recipe. |
| `errors.reference.program_wrong_station` | This recipe belongs to another station. |
| `errors.reference.stock_time_exceeds_cook_time` | Must be shorter than the cooking time. |
| `errors.NOT_FOUND_stale` | Someone removed this. The page is refreshed. |
| `errors.network` | The cloud cannot be reached. Check the internet connection; what you typed is kept. |
| `errors.UNKNOWN` | Something went wrong. Try again. |
