# 03a cloud lane: new Urdu strings for native read

Every Urdu string added or changed on `module-03a-cloud` since it left `module-03a`, read from `apps/client/src/i18n/{en,ur}.ts`. All are drafts by implementers, not reviewed by a native speaker. `{name}` style placeholders are filled at run time and must stay as they are.

Known point to rule on: "piece" is written نگ in these drafts but عدد in the existing money line.

**Counts:** 449 added, 0 changed. New English keys with no Urdu yet: 0. Urdu value with no Urdu letters: 2.

## Added (449)

| Key | English | Urdu |
|---|---|---|
| `archive.and_more` | and {n} more | اور {n} مزید |
| `archive.archive_name` | Archive {name} | {name} آرکائیو کریں |
| `archive.archived` | Archived | آرکائیو ہو گیا |
| `archive.blocked_title` | {name} can't be archived yet | {name} ابھی آرکائیو نہیں ہو سکتا |
| `archive.category_body` | It stops showing on the order screen at every branch. You can restore it from Archived. | یہ ہر برانچ کی آرڈر اسکرین سے ہٹ جائے گی۔ آرکائیو سے بحال کر سکتے ہیں۔ |
| `archive.in_use_body` | {n} items still use it. Move them to another one or archive them first. | {n} آئٹم ابھی اسے استعمال کرتے ہیں۔ پہلے انہیں کسی اور پر لے جائیں یا آرکائیو کریں۔ |
| `archive.in_use_deals` | {n} deals still use it. Change what they use or archive them first. | {n} ڈیلز ابھی اسے استعمال کرتی ہیں۔ ان کی ترتیب بدلیں یا پہلے آرکائیو کریں۔ |
| `archive.in_use_size_groups` | {n} size groups still use it. Move them to another category or archive them first. | {n} سائز گروپ ابھی اسے استعمال کرتے ہیں۔ انہیں دوسری کیٹیگری میں لے جائیں یا پہلے آرکائیو کریں۔ |
| `archive.item_body` | It disappears from ordering at every branch within a minute. Past orders and reports keep it. You can restore it from Archived. | ایک منٹ میں ہر برانچ کے آرڈر سے ہٹ جائے گا۔ پرانے آرڈر اور رپورٹیں اسے رکھتی ہیں۔ آرکائیو سے بحال کر سکتے ہیں۔ |
| `archive.item_title` | Archive {name}? | {name} آرکائیو کریں؟ |
| `archive.open_deals` | Open deals | ڈیلز کھولیں |
| `archive.open_items` | Open these items | یہ آئٹم کھولیں |
| `archive.open_size_groups` | Open size groups | سائز گروپ کھولیں |
| `archive.open_stock_items` | Open stock items | اسٹاک آئٹم کھولیں |
| `archive.station_blocked_body` | {n} items are cooked here. Move them to another station or mark them Not sold here at {branch} first. | {n} آئٹم یہاں پکتے ہیں۔ پہلے انہیں دوسرے اسٹیشن پر لے جائیں یا {branch} میں “یہاں نہیں بکتا” لگائیں۔ |
| `archive.station_blocked_by_stations` | {n} other stations list this one as an alternate. Remove it from their alternates first. | {n} دوسرے اسٹیشن اسے متبادل کے طور پر رکھتے ہیں۔ پہلے اسے ان کے متبادل سے ہٹائیں۔ |
| `archive.station_blocked_by_stock` | {n} stock items are counted at this station. Move them to another station first. | {n} اسٹاک آئٹم اس اسٹیشن پر گنے جاتے ہیں۔ پہلے انہیں دوسرے اسٹیشن پر لے جائیں۔ |
| `archive.station_body` | Cooks at this branch stop seeing it. You can restore it from Show archived. | اس برانچ کے باورچیوں کو یہ نظر نہیں آئے گا۔ آرکائیو دکھائیں سے اسے بحال کر سکتے ہیں۔ |
| `archive.station_type_blocked` | The cooking type can't change while items use {name} | جب تک آئٹم {name} استعمال کریں، پکانے کا طریقہ نہیں بدل سکتا |
| `archive.tax_body` | New items can no longer pick it. You can restore it from Archived. | نئے آئٹم اسے نہیں چن سکیں گے۔ آرکائیو سے بحال کر سکتے ہیں۔ |
| `branches.ago_days` | {n} days ago | {n} دن پہلے |
| `branches.ago_now` | just now | ابھی |
| `branches.away` | {branch} hub last checked {seen}. | {branch} کا ہب آخری بار {seen} چیک ہوا۔ |
| `branches.away_body` | It gets the change when it is back online. | آن لائن واپس آنے پر اسے تبدیلی مل جائے گی۔ |
| `branches.back_short` | Branches | برانچیں |
| `branches.gap_not_less` | Must be less than the stale-day hours ({n}). | پرانے دن کے گھنٹوں ({n}) سے کم ہونا چاہیے۔ |
| `branches.gap_range` | Use 0 to 12 hours. | 0 سے 12 گھنٹے لکھیں۔ |
| `branches.name` | Branch name | برانچ کا نام |
| `branches.name_help` | Up to 60 letters. Different from your other branches. | زیادہ سے زیادہ 60 حروف۔ آپ کی دوسری برانچوں سے الگ۔ |
| `branches.name_required` | Type a name, up to 60 letters. | نام لکھیں، زیادہ سے زیادہ 60 حروف۔ |
| `branches.name_taken` | Another branch is called {name}. | ایک اور برانچ کا نام {name} ہے۔ |
| `branches.never_synced` | Not up to date yet. | ابھی تازہ نہیں۔ |
| `branches.rename_note` | The hub screens at the branch keep showing the old name for now. | برانچ کی ہب اسکرینوں پر ابھی پرانا نام دکھتا رہے گا۔ |
| `branches.rename_title` | Rename {name} | {name} کا نام بدلیں |
| `branches.renamed` | Renamed to {name}. | نام بدل کر {name} ہو گیا۔ |
| `branches.renamed_body` | The hub screens there keep the old name for now. | وہاں کی ہب اسکرینوں پر ابھی پرانا نام رہے گا۔ |
| `branches.settings_saved` | Settings saved. {name} gets them within about a minute. | سیٹنگ محفوظ ہو گئی۔ {name} کو تقریباً ایک منٹ میں مل جائے گی۔ |
| `branches.stale_range` | Use 1 to 48 hours. | 1 سے 48 گھنٹے لکھیں۔ |
| `branches.timing` | Kitchen timing | کچن ٹائمنگ |
| `branches.timing.cascade_step_ms` | Re-plan step | دوبارہ منصوبے کا قدم |
| `branches.timing.min_gain_ms` | Smallest gain worth re-planning | دوبارہ منصوبے کے لیے کم از کم فائدہ |
| `branches.timing.order_abandon_ms` | Drop an untouched order after | ہاتھ نہ لگا آرڈر اتنے بعد ہٹائیں |
| `branches.timing.others` | Running late and other limits | تاخیر اور دوسری حدیں |
| `branches.timing.others_help` | Minutes. Fractions are fine: 0.5 is 30 seconds. | منٹ۔ اعشاریہ چلتا ہے: 0.5 یعنی 30 سیکنڈ۔ |
| `branches.timing.paddings` | Promise padding | وعدے میں اضافی وقت |
| `branches.timing.paddings_help` | Extra minutes added to the time promised to the customer, by order kind. A station can set its own. | گاہک سے کیے گئے وعدے میں آرڈر کی قسم کے مطابق اضافی منٹ۔ اسٹیشن اپنا الگ بھی رکھ سکتا ہے۔ |
| `branches.timing.promise_padding_delivery_ms` | Delivery | ڈیلیوری |
| `branches.timing.promise_padding_dine_in_ms` | Dine-in | ڈائن اِن |
| `branches.timing.promise_padding_parking_ms` | Parking | پارکنگ |
| `branches.timing.promise_padding_takeaway_ms` | Takeaway | ٹیک اوے |
| `branches.timing.returns_boost` | Returned dishes jump the queue | واپس آئی ڈش قطار میں آگے |
| `branches.timing.returns_help` | A dish sent back is cooked next, ahead of waiting orders. | واپس بھیجی گئی ڈش انتظار والے آرڈروں سے پہلے پکتی ہے۔ |
| `branches.timing.returns_off` | Off | بند |
| `branches.timing.returns_on` | On | چالو |
| `branches.timing.slip_escalate_ms` | Raise the alarm after a further | مزید اتنے بعد الارم دیں |
| `branches.timing.slip_threshold_ms` | Warn when an order slips by | آرڈر اتنا پیچھے ہو تو خبردار کریں |
| `branches.timing.table_lock_ttl_ms` | Table hold time | ٹیبل روکنے کا وقت |
| `branches.timing.unit_min` | min | منٹ |
| `branches.timing.unit_pct` | % | % |
| `branches.timing.weight_delivery_pct` | Delivery | ڈیلیوری |
| `branches.timing.weight_dine_in_pct` | Dine-in | ڈائن اِن |
| `branches.timing.weight_follow_up_pct` | Added to a running order | چلتے آرڈر میں اضافہ |
| `branches.timing.weight_parking_pct` | Parking | پارکنگ |
| `branches.timing.weight_takeaway_pct` | Takeaway | ٹیک اوے |
| `branches.timing.weights` | Order weight | آرڈر کا وزن |
| `branches.timing.weights_help` | How much room an order of each kind takes in the kitchen queue. 100 is a normal dine-in order; a higher number puts that kind ahead. | ہر قسم کا آرڈر کچن کی قطار میں کتنی جگہ لیتا ہے۔ 100 عام ڈائن اِن آرڈر ہے؛ بڑا عدد اس قسم کو آگے رکھتا ہے۔ |
| `branches.timing_help` | How the kitchen promises and orders work for this branch. The standard values suit most restaurants; change one only when you know why. | اس برانچ میں کچن وعدے اور آرڈر کیسے چلتے ہیں۔ معیاری قدریں زیادہ تر ریستورانوں کے لیے ٹھیک ہیں؛ وجہ معلوم ہو تو ہی بدلیں۔ |
| `branches.timing_minutes_range` | Use {min} to {max} minutes. | {min} سے {max} منٹ لکھیں۔ |
| `branches.timing_pct_range` | Use {min} to {max} percent. | {min} سے {max} فیصد لکھیں۔ |
| `common.and` | and | اور |
| `common.cancel` | Cancel | منسوخ کریں |
| `common.close` | Close | بند کریں |
| `common.cloud_down` | Can't reach the restaurant cloud — retrying… | ریسٹورنٹ کلاؤڈ تک رسائی نہیں — دوبارہ کوشش جاری ہے… |
| `common.cloud_down_body` | Your changes stay on this page. Save works again when the internet is back. | آپ کی تبدیلیاں اس صفحے پر رہیں گی۔ انٹرنیٹ آنے پر محفوظ ہو سکے گا۔ |
| `common.loading` | Loading… | لوڈ ہو رہا ہے… |
| `common.saved` | Saved | محفوظ ہو گیا |
| `common.slow` | Still working. This can take a few seconds. | کام جاری ہے۔ اس میں چند سیکنڈ لگ سکتے ہیں۔ |
| `common.undo` | Undo | واپس کریں |
| `discard.body` | You changed {fields}. They are not saved yet. | آپ نے {fields} بدلا ہے۔ یہ ابھی محفوظ نہیں۔ |
| `discard.discard` | Discard changes | تبدیلیاں چھوڑ دیں |
| `discard.keep` | Keep editing | ترمیم جاری رکھیں |
| `discard.title` | Discard your changes to {name}? | {name} کی تبدیلیاں چھوڑ دیں؟ |
| `errors.CONFIG_IN_USE` | Still in use. Archive or move what uses it first. | ابھی استعمال میں ہے۔ جو اسے استعمال کرتا ہے پہلے اسے آرکائیو کریں یا ہٹائیں۔ |
| `errors.CONFIG_NAME_TAKEN` | That name is already used. Choose another name. | یہ نام پہلے سے استعمال میں ہے۔ کوئی اور نام چنیں۔ |
| `errors.CONFIG_REFERENCE_INVALID` | Something it points to is archived or missing. Choose another one. | جس چیز کا حوالہ ہے وہ آرکائیو ہے یا موجود نہیں۔ کوئی اور چنیں۔ |
| `errors.CONFIG_STALE` | Someone changed this since you opened it | آپ کے کھولنے کے بعد کسی نے اسے بدل دیا ہے |
| `errors.IDEMPOTENCY_KEY_MISMATCH` | This form was already saved with other values. The list is reloaded; check it before adding again. | یہ فارم پہلے دوسری قدروں سے محفوظ ہو چکا ہے۔ فہرست تازہ کر دی گئی ہے؛ مزید شامل کرنے سے پہلے اسے دیکھ لیں۔ |
| `errors.NOT_FOUND_stale` | Someone removed this. The page is refreshed. | کسی نے اسے ہٹا دیا ہے۔ صفحہ تازہ کر دیا گیا ہے۔ |
| `errors.OWN_ADMIN_ACCESS` | You can't remove your own admin access. Call support{support}. | آپ اپنی ایڈمن رسائی نہیں ہٹا سکتے۔ سپورٹ کو کال کریں{support}۔ |
| `errors.OWN_ADMIN_ACCESS_owner_not_linked` | Your owner login isn't linked to your staff profile yet, so admin access can't be removed. Call support{support} to link it. | آپ کا مالک لاگ اِن ابھی آپ کے اسٹاف پروفائل سے جڑا نہیں، اس لیے ایڈمن رسائی نہیں ہٹ سکتی۔ جوڑنے کے لیے سپورٹ کو کال کریں{support}۔ |
| `errors.PERMISSION_DENIED` | Only an owner of every branch can change this. | اسے صرف تمام برانچوں کا مالک بدل سکتا ہے۔ |
| `errors.UNKNOWN` | Something went wrong. Try again. | کچھ غلط ہو گیا۔ دوبارہ کوشش کریں۔ |
| `errors.VALIDATION_FAILED` | Check the fields and try again. | خانے چیک کر کے دوبارہ کوشش کریں۔ |
| `errors.network` | The cloud cannot be reached. Check the internet connection; what you typed is kept. | کلاؤڈ تک رسائی نہیں ہو رہی۔ انٹرنیٹ چیک کریں؛ جو لکھا ہے وہ محفوظ ہے۔ |
| `errors.reference.archived` | This was archived. Pick another one. | یہ آرکائیو ہو چکا ہے۔ کوئی اور چنیں۔ |
| `errors.reference.category_mismatch` | Put this item in the same category as its size group. | اس آئٹم کو اس کے سائز گروپ والی کیٹیگری میں رکھیں۔ |
| `errors.reference.not_found` | This no longer exists. Pick another one. | یہ اب موجود نہیں۔ کوئی اور چنیں۔ |
| `errors.reference.not_slot` | Only stations that cook each order can be used here. | یہاں صرف ہر آرڈر الگ پکانے والے اسٹیشن استعمال ہو سکتے ہیں۔ |
| `errors.reference.program_not_allowed` | This station cooks each order; it takes no recipe. | یہ اسٹیشن ہر آرڈر الگ پکاتا ہے؛ اسے ترکیب نہیں چاہیے۔ |
| `errors.reference.program_required` | Choose a batch recipe. | بیچ کی ترکیب چنیں۔ |
| `errors.reference.program_wrong_station` | This recipe belongs to another station. | یہ ترکیب کسی اور اسٹیشن کی ہے۔ |
| `errors.reference.self` | A station cannot be its own alternate. | اسٹیشن اپنا ہی متبادل نہیں ہو سکتا۔ |
| `errors.reference.stock_time_exceeds_cook_time` | Must be shorter than the cooking time. | پکنے کے وقت سے کم ہونا چاہیے۔ |
| `errors.reference.unit_mismatch` | This stock is counted in a different unit. Sell this item by piece, or pick other stock. | یہ اسٹاک کسی اور اکائی میں گنا جاتا ہے۔ یہ آئٹم نگ میں بیچیں یا دوسرا اسٹاک چنیں۔ |
| `errors.reference.unit_mismatch_stock` | Some dishes use this stock in the old unit. Change those dishes first. | کچھ ڈشیں یہ اسٹاک پرانی اکائی میں استعمال کرتی ہیں۔ پہلے وہ ڈشیں بدلیں۔ |
| `errors.reference.wrong_branch` | This station belongs to another branch. | یہ اسٹیشن کسی اور برانچ کا ہے۔ |
| `form.above_capacity` | Can't be more than how many it takes at once. | ایک وقت کی گنجائش سے زیادہ نہیں ہو سکتا۔ |
| `form.amber_below_red` | Must be below the red level. | سرخ سطح سے کم ہونا چاہیے۔ |
| `form.length_max` | Use up to {max} letters. | زیادہ سے زیادہ {max} حروف لکھیں۔ |
| `form.range.max` | Use {max} or less. | {max} یا اس سے کم لکھیں۔ |
| `form.range.max_minutes` | Use {max} minutes or less. | {max} منٹ یا اس سے کم لکھیں۔ |
| `form.range.max_percent` | Use {max} percent or less. | {max} فیصد یا اس سے کم لکھیں۔ |
| `form.range.min` | Use {min} or more. | {min} یا اس سے زیادہ لکھیں۔ |
| `form.range.min_minutes` | Use {min} minutes or more. | {min} منٹ یا اس سے زیادہ لکھیں۔ |
| `form.range.min_percent` | Use {min} percent or more. | {min} فیصد یا اس سے زیادہ لکھیں۔ |
| `goeswith.add` | Add a suggestion | تجویز شامل کریں |
| `goeswith.category` | Category | کیٹیگری |
| `goeswith.failed` | The menu could not be read. Close this form and open it again; goes-with is left as it was. | مینو نہیں پڑھا جا سکا۔ یہ فارم بند کر کے دوبارہ کھولیں؛ ساتھ چلنے والی چیزیں جیسی تھیں ویسی رہیں گی۔ |
| `goeswith.field_error` | This suggestion cannot be saved: a category or item it names was changed. Remove it or pick another. | یہ تجویز محفوظ نہیں ہو سکتی: اس میں نام لیا گیا کیٹیگری یا آئٹم بدل گیا ہے۔ اسے ہٹائیں یا دوسرا چنیں۔ |
| `goeswith.help` | Suggested together at the till: pick whole categories or single items. | کاؤنٹر پر ساتھ تجویز ہوتا ہے: پوری کیٹیگریاں یا الگ آئٹم چنیں۔ |
| `goeswith.help_item` | Mark a target "Never suggest" to stop a category suggestion from showing this dish here. | کسی ہدف پر "کبھی تجویز نہ کریں" لگائیں تو کیٹیگری کی تجویز میں یہ ڈش یہاں نہیں آئے گی۔ |
| `goeswith.item` | Item | آئٹم |
| `goeswith.loading` | Reading the menu… | مینو پڑھا جا رہا ہے… |
| `goeswith.never` | Never suggest | کبھی تجویز نہ کریں |
| `goeswith.none` | Nothing suggested yet. | ابھی کوئی تجویز نہیں۔ |
| `goeswith.pick` | Choose a category or item | کیٹیگری یا آئٹم چنیں |
| `goeswith.remove` | Remove {name} | {name} ہٹائیں |
| `goeswith.title` | Goes with | ساتھ جاتا ہے |
| `item.add` | Add item | آئٹم شامل کریں |
| `item.archive_body` | It disappears from ordering. Past orders keep it. | یہ آرڈر سے ہٹ جائے گا۔ پرانے آرڈروں میں رہے گا۔ |
| `item.branches_body` | Where it is sold, its price there, and which station cooks it. Leave the price empty to use the main price (Rs {price}). | کہاں بکتا ہے، وہاں قیمت کیا ہے اور کون سا اسٹیشن پکاتا ہے۔ اصل قیمت ({price} روپے) کے لیے قیمت خالی چھوڑیں۔ |
| `item.branches_title` | Branches and kitchen | برانچیں اور کچن |
| `item.changed.cook` | the cooking time | پکنے کا وقت |
| `item.changed.kitchen` | the kitchen | کچن |
| `item.changed.name` | the name | نام |
| `item.changed.other` | other details | دوسری تفصیلات |
| `item.changed.price` | the price | قیمت |
| `item.cook_n` | Cooks {n} min | {n} منٹ پکتا ہے |
| `item.create_stock_note` | For food cooked ahead and kept ready. | پہلے سے پکا کر رکھے کھانے کے لیے۔ |
| `item.creating` | Creating stock item… ({n} of {total}) | اسٹاک آئٹم بن رہا ہے… ({total} میں سے {n}) |
| `item.fix_n` | {n} things to fix before saving | محفوظ کرنے سے پہلے {n} چیزیں ٹھیک کریں |
| `item.in_use_body` | It is still offered here. Change or archive these first. | یہ ابھی یہاں پیش ہو رہا ہے۔ پہلے انہیں بدلیں یا آرکائیو کریں۔ |
| `item.in_use_change` | {name} can't be changed yet | {name} ابھی نہیں بدل سکتا |
| `item.in_use_deals` | Deals: {n} | ڈیل: {n} |
| `item.in_use_groups` | Choice groups: {n} | چوائس گروپ: {n} |
| `item.keeps` | keeps overnight | رات بھر رہتا ہے |
| `item.kept_ready` | Kept ready | تیار رکھا جاتا ہے |
| `item.mini_note` | Keeps overnight and alerts can be set later on the stock item. | رات بھر رکھنا اور الرٹ بعد میں اسٹاک آئٹم پر لگائے جا سکتے ہیں۔ |
| `item.mini_save_first` | Save the item first: Sold by or a branch station has changed. | پہلے آئٹم محفوظ کریں: “کیسے بکتا ہے” یا کسی برانچ کا اسٹیشن بدلا ہے۔ |
| `item.mini_uses_help` | How much of the pot one {size} takes. | ایک {size} میں دیگ کا کتنا حصہ لگتا ہے۔ |
| `item.mini_uses_placeholder` | e.g. 0.5 | مثلاً 0.5 |
| `item.more_n` | +{n} more | +{n} مزید |
| `item.need_category` | Add a category first. | پہلے کیٹیگری شامل کریں۔ |
| `item.need_cook` | Enter a cooking time from 1 minute to 4 hours. | پکنے کا وقت 1 منٹ سے 4 گھنٹے تک لکھیں۔ |
| `item.need_name` | Enter a name, up to 60 letters. | نام لکھیں، زیادہ سے زیادہ 60 حروف۔ |
| `item.need_prep` | Enter minutes, or leave it empty. | منٹ لکھیں یا خالی چھوڑ دیں۔ |
| `item.need_price` | Enter the price in rupees, like 1,200. | قیمت روپے میں لکھیں، جیسے 1,200۔ |
| `item.need_size_name` | Type a size name, up to 30 letters. | سائز کا نام لکھیں، زیادہ سے زیادہ 30 حروف۔ |
| `item.need_uses` | Type how much one sale uses, in the stock item’s unit. | لکھیں کہ ایک فروخت میں کتنا لگتا ہے، اسٹاک آئٹم کی اکائی میں۔ |
| `item.no_keep` | doesn't keep overnight | رات بھر نہیں رہتا |
| `item.no_recipe_needed` | Cooks each order · no recipe needed | ہر آرڈر الگ پکتا ہے · ترکیب کی ضرورت نہیں |
| `item.partial` | Item saved. One branch was not. | آئٹم محفوظ ہو گیا۔ ایک برانچ نہیں ہوئی۔ |
| `item.partial_body` | {branch}: {reason} Pick another station or Not sold here, then save again. | {branch}: {reason} کوئی اور اسٹیشن یا “یہاں نہیں بکتا” چنیں، پھر دوبارہ محفوظ کریں۔ |
| `item.partway` | Stock item made, but the item isn't linked yet. | اسٹاک آئٹم بن گیا، مگر آئٹم ابھی جڑا نہیں۔ |
| `item.partway_body` | “{name}” is on Stock items. Finish linking to count it for this dish. | “{name}” اسٹاک آئٹم میں ہے۔ اس ڈش کی گنتی کے لیے جوڑنا مکمل کریں۔ |
| `item.per_kg` | per kg | فی کلو |
| `item.per_l` | per L | فی لیٹر |
| `item.per_piece` | per piece | فی نگ |
| `item.preview` | How staff will see it | عملے کو کیسا دکھے گا |
| `item.price_at` | Price at {branch} | {branch} میں قیمت |
| `item.price_here` | Price here | یہاں قیمت |
| `item.price_same` | Same: {price} | وہی: {price} |
| `item.price_was` | Was Rs {old}. Open orders keep the old price. | پہلے {old} روپے تھی۔ کھلے آرڈروں پر پرانی قیمت رہتی ہے۔ |
| `item.quick_group` | Size group: {name} | سائز گروپ: {name} |
| `item.reach_branches` | Each branch gets the new price within a minute. | ہر برانچ کو نئی قیمت ایک منٹ میں مل جاتی ہے۔ |
| `item.save` | Save item | آئٹم محفوظ کریں |
| `item.save_branch_again` | Save {branch} again | {branch} دوبارہ محفوظ کریں |
| `item.save_price` | Save price | قیمت محفوظ کریں |
| `item.section.customers` | What customers see | گاہک کیا دیکھتے ہیں |
| `item.section.hours` | Hours | اوقات |
| `item.section.kitchen` | Kitchen | کچن |
| `item.section.price` | Price | قیمت |
| `item.section.stock` | Ready-made stock | تیار اسٹاک |
| `item.size_name_help` | Shown on the tile, e.g. Half · Full. | ٹائل پر دکھتا ہے، جیسے ہاف · فل۔ |
| `item.size_name_placeholder` | e.g. Half | مثلاً ہاف |
| `item.size_pick` | Choose a size group | سائز گروپ چنیں |
| `item.size_section_plain` | Is this one size of a dish, like Half or Full? | کیا یہ کسی ڈش کا ایک سائز ہے، جیسے ہاف یا فل؟ |
| `item.stock_head` | {name} · counted in {unit} · {keeps} | {name} · {unit} میں گنتی · {keeps} |
| `item.stock_help` | Optional. Link the pot or pack this dish is served from. | اختیاری۔ وہ دیگ یا پیک جوڑیں جس سے یہ ڈش دی جاتی ہے۔ |
| `item.stock_line_alert` | {branch}: {station}, alert below {n} | {branch}: {station}، {n} سے کم پر الرٹ |
| `item.stock_line_none` | {branch}: not counted | {branch}: گنتی نہیں |
| `item.stock_linked` | The pot or pack this dish is served from. | وہ دیگ یا پیک جس سے یہ ڈش دی جاتی ہے۔ |
| `item.stock_linked_shared` | The pot or pack this dish is served from. Shared with other sizes of this dish. | وہ دیگ یا پیک جس سے یہ ڈش دی جاتی ہے۔ اس ڈش کے دوسرے سائز کے ساتھ مشترک۔ |
| `item.stock_not_used` | Not used: items weighed when served don't use stock. | استعمال نہیں: دیتے وقت تولے جانے والے آئٹم اسٹاک استعمال نہیں کرتے۔ |
| `item.stock_time_long` | Must be shorter than the cooking time ({n} min). | پکنے کے وقت ({n} منٹ) سے کم ہونا چاہیے۔ |
| `item.sum_not_counted` | Not counted on the hub | ہب پر گنتی نہیں |
| `item.sum_own_tile` | Its own tile | اپنی الگ ٹائل |
| `item.sum_tile` | One tile “{group}” · size {size} | ایک ٹائل “{group}” · سائز {size} |
| `item.sum_weighed` | Weight typed when ordering | آرڈر کرتے وقت وزن لکھا جاتا ہے |
| `item.timing` | Timing | ٹائمنگ |
| `item.timing.adjust` | Cook time when sent back to fix (min) | ٹھیک کرنے کے لیے واپس آئے تو پکنے کا وقت (منٹ) |
| `item.timing.adjust_help` | How long the kitchen cooks this dish again when it comes back to be fixed. | ڈش ٹھیک کرنے کے لیے واپس آئے تو کچن اسے دوبارہ کتنی دیر پکاتا ہے۔ |
| `item.timing.max_carry` | Can wait on the pass for (min) | پاس پر اتنی دیر رک سکتی ہے (منٹ) |
| `item.timing.max_carry_help` | Empty means no limit. | خالی کا مطلب کوئی حد نہیں۔ |
| `item.timing.max_early` | Can be ready early by (min) | اتنا پہلے تیار ہو سکتی ہے (منٹ) |
| `item.timing.max_late` | Can be late by (min) | اتنی دیر سے ہو سکتی ہے (منٹ) |
| `item.timing.max_late_help` | Empty means no limit. | خالی کا مطلب کوئی حد نہیں۔ |
| `item.timing.need_minutes` | Use {min} to {max} minutes. | {min} سے {max} منٹ لکھیں۔ |
| `item.timing.need_pct` | Use 10 to 1000 percent. | 10 سے 1000 فیصد لکھیں۔ |
| `item.timing.weight_help` | 10 to 1000 percent. 100 is a normal dish. | 10 سے 1000 فیصد۔ 100 عام ڈش ہے۔ |
| `item.timing.weight_pct` | Weight | وزن |
| `item.timing_help` | How the kitchen engine plans this dish. The standard values suit most dishes. | کچن انجن اس ڈش کی منصوبہ بندی کیسے کرتا ہے۔ معیاری قدریں زیادہ تر ڈشوں کے لیے ٹھیک ہیں۔ |
| `item.uses_a_sale` | {qty} a sale. | ایک فروخت میں {qty}۔ |
| `item.uses_help` | In the stock item's unit. | اسٹاک آئٹم کی اکائی میں۔ |
| `item.uses_same` | Counted in the unit it is sold by: each sale uses the amount sold. | جس اکائی میں بکتا ہے اسی میں گنا جاتا ہے: ہر فروخت میں جتنا بکا اتنا لگتا ہے۔ |
| `item.weighed_help` | The order taker types the weight when ordering or at the counter. | آرڈر لینے والا آرڈر کرتے وقت یا کاؤنٹر پر وزن لکھتا ہے۔ |
| `menu.cats_order_help` | Order sets where the category shows on the order screen. 1 shows first. | ترتیب بتاتی ہے کہ آرڈر اسکرین پر کیٹیگری کہاں دکھے۔ 1 پہلے دکھتا ہے۔ |
| `menu.clear_search` | Clear search | تلاش صاف کریں |
| `menu.first.add` | Add | شامل کریں |
| `menu.first.add_categories` | Add categories | کیٹیگریاں شامل کریں |
| `menu.first.add_items` | Add items | آئٹم شامل کریں |
| `menu.first.body` | Five steps. You can come back to any of them later. Each branch gets the changes within a minute. | پانچ مرحلے۔ آپ کسی پر بھی بعد میں واپس آ سکتے ہیں۔ ہر برانچ کو تبدیلیاں ایک منٹ میں مل جاتی ہیں۔ |
| `menu.first.categories` | Groups on the order screen, like Breakfast, Karahi, Breads, Drinks. | آرڈر اسکرین کے گروپ، جیسے ناشتہ، کڑاہی، روٹیاں، مشروبات۔ |
| `menu.first.floors` | The tables waiters pick, floor by floor. | وہ میزیں جو ویٹر چنتے ہیں، فلور بہ فلور۔ |
| `menu.first.items` | Needs at least one category. | کم از کم ایک کیٹیگری چاہیے۔ |
| `menu.first.stations` | Where food is cooked at each branch: tandoor, karahi counter, degh. | ہر برانچ میں کھانا کہاں پکتا ہے: تندور، کڑاہی کاؤنٹر، دیگ۔ |
| `menu.first.tax` | Skip if you don't charge tax. "No tax" is the default. | ٹیکس نہیں لیتے تو چھوڑ دیں۔ معیاری “کوئی ٹیکس نہیں” ہے۔ |
| `menu.first.tax_title` | Tax rates (optional) | ٹیکس ریٹ (اختیاری) |
| `menu.first.title` | Welcome, let's set up your restaurant | خوش آمدید، آئیے آپ کا ریسٹورنٹ سیٹ کریں |
| `menu.group_n` | Group: {name} | گروپ: {name} |
| `menu.item_gone` | This item isn't here any more. It may have been deleted on another device. | یہ آئٹم اب یہاں نہیں۔ شاید کسی اور ڈیوائس پر ہٹا دیا گیا ہے۔ |
| `menu.new_tax` | New tax rate | نیا ٹیکس ریٹ |
| `menu.no_items` | No items here | یہاں کوئی آئٹم نہیں |
| `menu.no_match` | No items match “{q}” | “{q}” سے کوئی آئٹم نہیں ملا |
| `menu.no_match_body` | Check the spelling, or look in Archived. | ہجے چیک کریں یا آرکائیو میں دیکھیں۔ |
| `menu.open_group` | Open {name} | {name} کھولیں |
| `menu.per.l` | / L | / لیٹر |
| `menu.read_only_body` | Only an owner of every branch can change the shared menu. | مشترکہ مینیو صرف تمام برانچوں کا مالک بدل سکتا ہے۔ |
| `menu.section` | Section | حصہ |
| `menu.show_archived` | Show archived | آرکائیو دکھائیں |
| `menu.tax_default` | Default for new items | نئے آئٹموں کے لیے معیاری |
| `menu.view` | View | دیکھیں |
| `owner.branch` | Branch | برانچ |
| `owner.branch_body` | Floors, tables and kitchen stations belong to one branch. You can switch any time from the top of the page. | فلور، میزیں اور کچن اسٹیشن ایک برانچ کے ہوتے ہیں۔ آپ صفحے کے اوپر سے کبھی بھی بدل سکتے ہیں۔ |
| `owner.branch_title` | Which branch are you setting up? | آپ کون سی برانچ سیٹ کر رہے ہیں؟ |
| `owner.category.edit` | Edit category | کیٹیگری میں ترمیم |
| `owner.category.hours_note` | Every item in {name} follows these hours. An item can narrow them further, never widen them. | {name} کے ہر آئٹم پر یہی اوقات لگتے ہیں۔ آئٹم انہیں کم کر سکتا ہے، بڑھا نہیں سکتا۔ |
| `owner.category.name` | Category name | کیٹیگری کا نام |
| `owner.category.new` | New category | نئی کیٹیگری |
| `owner.category.position` | Position | ترتیب |
| `owner.category.position_help` | 1 shows first when ordering. | آرڈر کرتے وقت 1 پہلے دکھتا ہے۔ |
| `owner.category.save` | Save category | کیٹیگری محفوظ کریں |
| `owner.category.this` | this category | یہ کیٹیگری |
| `owner.common.archive` | Archive | آرکائیو کریں |
| `owner.common.archived` | Archived | آرکائیو |
| `owner.common.cancel` | Cancel | منسوخ کریں |
| `owner.common.restore` | Restore | بحال کریں |
| `owner.common.show_archived` | Show archived | آرکائیو دکھائیں |
| `owner.continue_with` | Continue with {branch} | {branch} کے ساتھ جاری رکھیں |
| `owner.hours.add_n` | Add hours ({n} more allowed) | اوقات شامل کریں ({n} مزید ہو سکتے ہیں) |
| `owner.hours.all_day` | All day | سارا دن |
| `owner.hours.always` | Always available | ہمیشہ دستیاب |
| `owner.hours.category_has` | The category's hours also apply. {name}: {hours}. | کیٹیگری کے اوقات بھی لگتے ہیں۔ {name}: {hours}۔ |
| `owner.hours.category_none` | The category's hours also apply. {name} has none. | کیٹیگری کے اوقات بھی لگتے ہیں۔ {name} کے کوئی اوقات نہیں۔ |
| `owner.hours.equal` | From and To must be different. | شروع اور آخر کا وقت الگ ہونا چاہیے۔ |
| `owner.hours.from` | From | سے |
| `owner.hours.invalid` | Enter times as HH:MM. | وقت HH:MM میں لکھیں۔ |
| `owner.hours.label` | Available hours | دستیاب اوقات |
| `owner.hours.overlap` | Can be ordered {hours} (item and category overlap) | {hours} آرڈر ہو سکتا ہے (آئٹم اور کیٹیگری کے مشترک اوقات) |
| `owner.hours.remove` | Remove | ہٹائیں |
| `owner.hours.set_hours` | Only at set hours | صرف طے شدہ اوقات میں |
| `owner.hours.to` | To | تک |
| `owner.hours.wraps` | {hours} runs past midnight | {hours} آدھی رات کے بعد تک چلتا ہے |
| `owner.item.cook_fresh` | Cook fresh | تازہ پکائیں |
| `owner.item.cook_minutes` | Cooking time (min) | پکنے کا وقت (منٹ) |
| `owner.item.description` | Short description (optional) | مختصر تفصیل (اختیاری) |
| `owner.item.edit` | Edit item | آئٹم میں ترمیم |
| `owner.item.name` | Item name | آئٹم کا نام |
| `owner.item.new` | New item | نیا آئٹم |
| `owner.item.no_stock_program` | None | کوئی نہیں |
| `owner.item.no_tax` | No tax | کوئی ٹیکس نہیں |
| `owner.item.not_sold_here` | Not sold here | یہاں نہیں بکتا |
| `owner.item.out_of_stock` | When pre-cooked stock runs out | پہلے سے پکا اسٹاک ختم ہو تو |
| `owner.item.prep_minutes` | Extra time to plate (min) | پلیٹ لگانے کا اضافی وقت (منٹ) |
| `owner.item.price` | Price | قیمت |
| `owner.item.program` | Batch recipe | بیچ کی ترکیب |
| `owner.item.sale_unit` | Sold by | کیسے بکتا ہے |
| `owner.item.serve_immediate` | When ready | تیار ہوتے ہی |
| `owner.item.serve_mode` | Serve | کب دیں |
| `owner.item.serve_sync` | With the table | میز کے ساتھ |
| `owner.item.sold_out` | Sold out | ختم |
| `owner.item.station` | Station | اسٹیشن |
| `owner.item.stock_program` | Pre-cooked batch recipe | پہلے سے پکے بیچ کی ترکیب |
| `owner.item.stock_time_minutes` | Serve from stock in (min) | اسٹاک سے دینے کا وقت (منٹ) |
| `owner.item.tax_class` | Tax | ٹیکس |
| `owner.item.unit_g` | Grams (shown as kg) | گرام (کلو میں دکھتا ہے) |
| `owner.item.unit_ml` | Millilitres (shown as L) | ملی لیٹر (لیٹر میں دکھتا ہے) |
| `owner.item.unit_piece` | Pieces | نگ |
| `owner.menu.add_tax_class` | Add tax rate | ٹیکس ریٹ شامل کریں |
| `owner.menu.all_categories` | All categories | تمام کیٹیگریاں |
| `owner.menu.category_filter` | Category | کیٹیگری |
| `owner.menu.load_more` | Load more | مزید دکھائیں |
| `owner.menu.new_category` | New category | نئی کیٹیگری |
| `owner.menu.new_tax_class` | New tax rate name | نئے ٹیکس ریٹ کا نام |
| `owner.menu.rate_percent` | Rate | ریٹ |
| `owner.menu.read_only` | You can see the menu but not change it. | آپ مینیو دیکھ سکتے ہیں مگر بدل نہیں سکتے۔ |
| `owner.menu.rupees` | Rs | روپے |
| `owner.nav.floors_short` | Floors | فلور |
| `owner.nav.points` | Points | پوائنٹس |
| `owner.nav.stations_short` | Stations | اسٹیشن |
| `owner.open_menu` | Open the menu | مینیو کھولیں |
| `owner.points.add` | Add point | پوائنٹ شامل کریں |
| `owner.points.archive_body` | No station can send food here after this. You can restore it later. | اس کے بعد کوئی اسٹیشن یہاں کھانا نہیں بھیج سکے گا۔ بعد میں بحال کر سکتے ہیں۔ |
| `owner.points.blocked_body` | {name} is still used by {n} stations: {names}. Move them to another point first. | {name} کو ابھی {n} اسٹیشن استعمال کرتے ہیں: {names}۔ پہلے انہیں دوسرے پوائنٹ پر لے جائیں۔ |
| `owner.points.empty` | No points yet | ابھی کوئی پوائنٹ نہیں |
| `owner.points.empty_body` | Add a point, then choose it on each kitchen station. | پوائنٹ شامل کریں، پھر ہر کچن اسٹیشن پر اسے چنیں۔ |
| `owner.points.hide_archived` | Hide archived points | آرکائیو پوائنٹس چھپائیں |
| `owner.points.intro` | A point is where finished food is handed over: the pass, the tandoor window, the counter. Each station sends its food to one point. | پوائنٹ وہ جگہ ہے جہاں تیار کھانا حوالے کیا جاتا ہے: پاس، تندور کی کھڑکی، کاؤنٹر۔ ہر اسٹیشن اپنا کھانا ایک پوائنٹ پر بھیجتا ہے۔ |
| `owner.points.more` | More for points | پوائنٹس کے مزید اختیارات |
| `owner.points.name` | Point name | پوائنٹ کا نام |
| `owner.points.new_body` | Where finished food is handed over. | جہاں تیار کھانا حوالے کیا جاتا ہے۔ |
| `owner.points.new_title` | Add a point | پوائنٹ شامل کریں |
| `owner.points.open_stations` | Open stations | اسٹیشن کھولیں |
| `owner.points.position_n` | Position {n} | ترتیب {n} |
| `owner.points.rename` | Rename | نام بدلیں |
| `owner.points.rename_title` | Rename point | پوائنٹ کا نام بدلیں |
| `owner.points.save` | Save point | پوائنٹ محفوظ کریں |
| `owner.points.sort` | Position (a number; lower shows first) | ترتیب (نمبر؛ چھوٹا پہلے آتا ہے) |
| `owner.points.title` | Points | پوائنٹس |
| `owner.stations.add_program` | Add recipe | ترکیب شامل کریں |
| `owner.stations.add_station` | Add station | اسٹیشن شامل کریں |
| `owner.stations.alternate_add` | Add a station | اسٹیشن شامل کریں |
| `owner.stations.alternate_home` | Home for | اپنے آرڈر |
| `owner.stations.alternate_need_type` | Choose at least one kind of order. | کم از کم ایک قسم کا آرڈر چنیں۔ |
| `owner.stations.alternate_none` | There is no other station that cooks each order. | ہر آرڈر الگ پکانے والا کوئی اور اسٹیشن نہیں ہے۔ |
| `owner.stations.alternate_pick` | Choose a station | اسٹیشن چنیں |
| `owner.stations.alternate_remove` | Remove {name} | {name} ہٹائیں |
| `owner.stations.alternate_serves` | Takes over | سنبھالتا ہے |
| `owner.stations.alternates` | Other stations that can cook for this one | دوسرے اسٹیشن جو اس کی جگہ پکا سکتے ہیں |
| `owner.stations.alternates_body` | Only stations that cook each order at this branch. Choose which kinds of order they take over, and which are their own. | اس برانچ کے صرف وہ اسٹیشن جو ہر آرڈر الگ پکاتے ہیں۔ چنیں کون سے آرڈر وہ سنبھالیں اور کون سے ان کے اپنے ہیں۔ |
| `owner.stations.archive_program` | Archive this recipe | یہ ترکیب آرکائیو کریں |
| `owner.stations.at_a_time` | {n} at a time | ایک وقت میں {n} |
| `owner.stations.capacity` | How many at once | ایک وقت میں کتنے |
| `owner.stations.capacity_batch` | Batches at the same time | ایک وقت میں کتنے بیچ |
| `owner.stations.carry_body` | Minutes to carry food from here to a point. Empty = 0. | یہاں سے پوائنٹ تک کھانا لے جانے کے منٹ۔ خالی = 0۔ |
| `owner.stations.carry_times` | Carry time to each point | ہر پوائنٹ تک لے جانے کا وقت |
| `owner.stations.carry_to` | To {point} (min) | {point} تک (منٹ) |
| `owner.stations.completion_mode` | Cook marks it done by | باورچی مکمل کیسے کرتا ہے |
| `owner.stations.cook_help` | Up to 4 hours. | زیادہ سے زیادہ 4 گھنٹے۔ |
| `owner.stations.cook_minutes` | Cooking time (min) | پکنے کا وقت (منٹ) |
| `owner.stations.cooks_batches` | cooks in batches | بیچ میں پکاتا ہے |
| `owner.stations.cooks_each` | cooks each order | ہر آرڈر الگ پکاتا ہے |
| `owner.stations.field.alternates` | the other stations | دوسرے اسٹیشن |
| `owner.stations.field.capacity` | how many at once | ایک وقت میں کتنے |
| `owner.stations.field.carry_times` | the carry times | لے جانے کے اوقات |
| `owner.stations.field.completion_mode` | how it is marked done | مکمل کرنے کا طریقہ |
| `owner.stations.field.freeze_ms` | the lock time | بند رہنے کا وقت |
| `owner.stations.field.freshness_window_ms` | the freshness time | تازگی کا وقت |
| `owner.stations.field.lane_units` | the lane capacity | لین کی گنجائش |
| `owner.stations.field.location_label` | where it is | جگہ |
| `owner.stations.field.min_slack_keep_ms` | the spare time | فالتو وقت |
| `owner.stations.field.name` | the name | نام |
| `owner.stations.field.pause_enabled` | can be paused | روکا جا سکتا ہے |
| `owner.stations.field.point_id` | the point | پوائنٹ |
| `owner.stations.field.policy` | how orders are ordered | آرڈر کی ترتیب |
| `owner.stations.field.pressure_alert_ms` | the busy alert time | رش الرٹ کا وقت |
| `owner.stations.field.pressure_amber_bp` | the amber level | زرد سطح |
| `owner.stations.field.pressure_red_bp` | the red level | سرخ سطح |
| `owner.stations.field.pressure_window_ms` | the busy check window | رش کی جانچ کا وقفہ |
| `owner.stations.field.promise_padding_ms` | the extra promise time | وعدے کا اضافی وقت |
| `owner.stations.field.reserve_units` | the urgent reserve | فوری آرڈر کا ذخیرہ |
| `owner.stations.field.station_type` | how it cooks | پکانے کا طریقہ |
| `owner.stations.freeze` | Locked once started for (min) | شروع ہونے کے بعد بند رہتا ہے (منٹ) |
| `owner.stations.freeze_help` | Default 2. Orders this close to starting are not moved. | ڈیفالٹ 2۔ شروع ہونے کے اتنے قریب آرڈر نہیں ہلتے۔ |
| `owner.stations.freshness_help` | After that it is not served from this batch. 0 = no limit. | اس کے بعد اس بیچ سے نہیں دیا جاتا۔ 0 = کوئی حد نہیں۔ |
| `owner.stations.freshness_minutes` | A cooked batch stays fresh for (min) | پکا ہوا بیچ اتنی دیر تازہ رہتا ہے (منٹ) |
| `owner.stations.lane_auto` | Automatic | خودکار |
| `owner.stations.lane_help` | Empty = shared out evenly. At most the capacity. | خالی = برابر بانٹ۔ گنجائش سے زیادہ نہیں۔ |
| `owner.stations.lane_units` | Capacity per lane | ہر لین کی گنجائش |
| `owner.stations.location_label` | Where it is (optional) | کہاں ہے (اختیاری) |
| `owner.stations.min_slack` | Keep this much spare time (min) | اتنا فالتو وقت رکھیں (منٹ) |
| `owner.stations.min_slack_help` | Default 1. | ڈیفالٹ 1۔ |
| `owner.stations.minutes_n` | {n} min | {n} منٹ |
| `owner.stations.mode_auto_done` | Itself, when the time is up | خود، وقت پورا ہونے پر |
| `owner.stations.mode_auto_done_short` | done when the time is up | وقت پورا ہونے پر مکمل |
| `owner.stations.mode_single_tap` | One Done tap | ایک بار مکمل دبانا |
| `owner.stations.mode_single_tap_short` | one Done tap | ایک بار مکمل دبانا |
| `owner.stations.mode_two_tap` | Start + Done taps | شروع + مکمل دبانا |
| `owner.stations.mode_two_tap_short` | cook taps Start and Done | باورچی شروع اور مکمل دباتا ہے |
| `owner.stations.new_program_for` | New batch recipe for {name} | {name} کے لیے بیچ کی نئی ترکیب |
| `owner.stations.new_program_title` | New batch recipe | بیچ کی نئی ترکیب |
| `owner.stations.new_station_body` | A station is a place where food is cooked: a tandoor, a karahi counter, a degh, a fryer. | اسٹیشن وہ جگہ ہے جہاں کھانا پکتا ہے: تندور، کڑاہی کاؤنٹر، دیگ، فرائر۔ |
| `owner.stations.new_station_title` | Add a kitchen station | کچن اسٹیشن شامل کریں |
| `owner.stations.order.delivery` | Delivery | ڈیلیوری |
| `owner.stations.order.dine_in` | Dine in | ڈائن اِن |
| `owner.stations.order.parking` | Parking | پارکنگ |
| `owner.stations.order.takeaway` | Takeaway | ٹیک اوے |
| `owner.stations.padding` | Extra time on promises (min) | وعدے پر اضافی وقت (منٹ) |
| `owner.stations.padding_branch` | Branch value | برانچ کی قدر |
| `owner.stations.padding_help` | Empty = use the branch value. | خالی = برانچ کی قدر۔ |
| `owner.stations.pause` | Can be paused | روکا جا سکتا ہے |
| `owner.stations.pause_help` | Lets the cook pause new work here. | باورچی یہاں نیا کام روک سکتا ہے۔ |
| `owner.stations.pause_off` | Can be paused: Off | روکا جا سکتا ہے: آف |
| `owner.stations.pause_on` | Can be paused: On | روکا جا سکتا ہے: آن |
| `owner.stations.point` | Hands food over at | کھانا یہاں حوالے کرتا ہے |
| `owner.stations.policy` | How orders are ordered | آرڈر کی ترتیب |
| `owner.stations.policy.edf` | Earliest promise first | جس کا وعدہ پہلے، وہ پہلے |
| `owner.stations.policy.fifo` | First in, first out | جو پہلے آیا، وہ پہلے |
| `owner.stations.policy.waada_guard` | Protect promised times (default) | وعدے کا وقت محفوظ رکھیں (ڈیفالٹ) |
| `owner.stations.pressure_alert` | Alert when busy for (min) | رش اتنی دیر رہے تو الرٹ (منٹ) |
| `owner.stations.pressure_amber` | Amber busy level (% of capacity over the window) | زرد رش کی سطح (وقفے میں گنجائش کا %) |
| `owner.stations.pressure_help` | Amber must be below red. | زرد، سرخ سے کم ہونا چاہیے۔ |
| `owner.stations.pressure_red` | Red busy level (% of capacity over the window) | سرخ رش کی سطح (وقفے میں گنجائش کا %) |
| `owner.stations.pressure_window` | Busy check looks ahead (min) | رش کی جانچ اتنا آگے دیکھتی ہے (منٹ) |
| `owner.stations.program_body` | One fixed cook for a whole pot. Items pick a recipe when they are cooked here. | پوری دیگ کے لیے ایک طے شدہ پکائی۔ یہاں پکنے والے آئٹم ترکیب چنتے ہیں۔ |
| `owner.stations.program_name` | Recipe name | ترکیب کا نام |
| `owner.stations.programs` | Batch recipes | بیچ کی ترکیبیں |
| `owner.stations.programs_body` | A fixed cook for a whole pot. | پوری دیگ کے لیے ایک طے شدہ پکائی۔ |
| `owner.stations.remove` | Remove | ہٹائیں |
| `owner.stations.reserve_help` | Other order types cannot use them. 0 to the capacity. | دوسری قسم کے آرڈر انہیں استعمال نہیں کر سکتے۔ 0 سے گنجائش تک۔ |
| `owner.stations.reserve_units` | Spaces kept for this station's own order types | اس اسٹیشن کے اپنے آرڈر کی قسموں کے لیے محفوظ جگہیں |
| `owner.stations.save_program` | Save recipe | ترکیب محفوظ کریں |
| `owner.stations.save_station` | Save station | اسٹیشن محفوظ کریں |
| `owner.stations.station_name` | Station name | اسٹیشن کا نام |
| `owner.stations.timing` | Timing | وقت |
| `owner.stations.timing_body` | How the kitchen plans this station. The defaults suit most stations. | کچن اس اسٹیشن کی منصوبہ بندی کیسے کرتا ہے۔ عام طور پر ڈیفالٹ ٹھیک رہتے ہیں۔ |
| `owner.stations.title` | Stations | اسٹیشن |
| `owner.stations.type` | How it cooks | کیسے پکاتا ہے |
| `owner.stations.type_batch` | In batches | بیچ میں |
| `owner.stations.type_locked` | Can't change while items use this station. | جب تک آئٹم یہ اسٹیشن استعمال کریں، یہ نہیں بدل سکتا۔ |
| `owner.stations.type_slot` | One order at a time | ایک وقت میں ایک آرڈر |
| `quantity.invalid` | Check the number: whole pieces, or kg and L with up to 3 decimals. | نمبر چیک کریں: پورے نگ، یا کلو اور لیٹر 3 اعشاریہ تک۔ |
| `quantity.l` | L | لیٹر |
| `quantity.pcs` | pcs | نگ |
| `size_group.draws` | Draws {qty} from {stock} | {stock} سے {qty} لیتا ہے |
| `stations.used_by_stations_names` | Used by {n} stations: {names} | {n} اسٹیشن استعمال کرتے ہیں: {names} |
| `stations.used_by_stations_short` | Used by {n} stations | {n} اسٹیشن استعمال کرتے ہیں |
| `stations.used_by_stock_names` | Used by {n} stock items: {names} | {n} اسٹاک آئٹم استعمال کرتے ہیں: {names} |
| `stations.used_by_stock_short` | Used by {n} stock items | {n} اسٹاک آئٹم استعمال کرتے ہیں |
| `stock_item.name` | Name | نام |
| `stock_items.at` | {branch}: {station} | {branch}: {station} |
| `tax.applies_note` | The new rate applies to every bill closed after you save, including tables that are open now. | نیا ریٹ محفوظ کرنے کے بعد بند ہونے والے ہر بل پر لگے گا، ابھی کھلی میزوں سمیت۔ |
| `tax.archive_title` | Archive this tax rate | یہ ٹیکس ریٹ آرکائیو کریں |
| `tax.edit` | Edit tax rate | ٹیکس ریٹ میں ترمیم |
| `tax.name` | Name | نام |
| `tax.name_help` | Staff see this on the bill. | عملہ یہ بل پر دیکھتا ہے۔ |
| `tax.rate` | Rate | ریٹ |
| `tax.rate_help` | Up to 2 decimals, e.g. 16 or 7.5. | زیادہ سے زیادہ 2 اعشاریہ، جیسے 16 یا 7.5۔ |
| `tax.save` | Save tax rate | ٹیکس ریٹ محفوظ کریں |
