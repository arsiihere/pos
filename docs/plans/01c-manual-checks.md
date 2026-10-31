# 01c manual checks (task 39 steps 4 and 5)

Two hand checks for 01c, on one laptop. They reuse the setup of `docs/manual-test-e2e.md` (shell helpers in `~/pos-manual/env.sh`, terminals **T1** cloud, **T2** hub, **T3** commands). Report each numbered result as **pass**, or **what I saw**.

Before each part, wipe as in e2e §8:

```sh
source ~/pos-manual/env.sh
rm -rf ~/pos-manual/hub ~/pos-manual/seed.txt
docker exec pos-pg-test dropdb -U pos --if-exists pos_manual
docker exec pos-pg-test createdb -U pos pos_manual
mkdir -p ~/pos-manual/hub/data ~/pos-manual/hub/backup
```

---

## Part A — Stock page on the 01c seed (spec §11 step 15, plan task 39 step 4)

A1. **Build and start the cloud** (T1), then seed (T3):

```sh
cd ~/pos && git switch module-01c && pnpm install && pnpm --filter @pos/client build
source ~/pos-manual/env.sh; cloud pnpm dev                        # T1
source ~/pos-manual/env.sh; cloud pnpm -s seed-demo | tee $M/seed.txt   # T3
cloud pnpm -s seed-demo                                           # T3, second run
```

Expect: the first run prints the owner login, three `branch … registration code` lines, the staff PINs and `menu: 14 items; variant group Chicken Karahi (Half 500 g, Full 1 000 g of Karahi pot); 7 stock items; modifier groups Spice level, Bread (Naan); Family karahi deal at every branch`. The second run prints `already seeded … nothing written` and exits 0.

A2. **Database check** (T3):

```sh
pg -c "select version from schema_migrations order by version"                 # 0001 … 0006
pg -c "select si.name, si.stock_unit, count(sib.*) from stock_items si left join stock_item_branches sib using (tenant_id, stock_item_id) group by 1,2 order by 1"
pg -c "select m.name, m.variant_name, d.quantity_per_sale_unit from stock_draws d join menu_items m using (tenant_id, item_id) join stock_items s using (tenant_id, stock_item_id) where s.name = 'Karahi pot'"
```

Expect: migrations up to `0006`; Karahi pot in `g` with 3 branch rows; Half draws 500 and Full 1 000 from it.

A3. **Hub** (T2): write the hub config and start it exactly as e2e §4a, register **Gulberg** at `http://localhost:3000/setup` (e2e §4b), restart the hub after it exits, open the bootstrap link and sign in as **Arif / 1234** (e2e §4c), then pair a second tab as a Cashier screen and open `http://<LAN_IP>:3000/admin/stock/` signed in as **Arif / 1234** (e2e §4d).

Expect: "Menu version N · checked just now" within 60 s (the 01c hub polls at once at boot when it holds no config, AD-19).

A4. **One pot, two drawers.** On the stock page:

Expect: **Karahi pot** appears **once**, in grams, with **Chicken Karahi — Half** and **Chicken Karahi — Full** listed under it, each with its own Selling switch. Items that draw no stock (e.g. Naan) show only the Selling switch.

A5. **Count.** Tap **Start day**. Count Karahi pot **6000** g → **Save counts**.

Expect: Half shows **12**, Full shows **6**.

A6. **Add.** Add **1000** g to Karahi pot → save.

Expect: the pot shows 7 000 g; Half **14**, Full **7**.

A7. **Reload** the page.

Expect: the same numbers (7 000 g, Half 14, Full 7).

A8. **A Tandoor counter does not see the pot.** In the owner app (`http://localhost:4000/owner/`, owner login from `$M/seed.txt`) do e2e §5.8–§5.13 with these changes: add **Tariq**, role Waiter, branch Gulberg, PIN **9191**; create the role **Stock counter** (Access hub admin = Allowed (Branch), Manage stock = Allowed, Where = **My stations**) if it does not exist; give Tariq that role; **Stock counting** (Gulberg) → **Tandoor**: add Tariq, save. On the hub, wait up to 60 s for the directory poll, pair another tab as a Cashier screen (e2e §6b), open `/admin/stock/`, sign in as **Tariq / 9191**.

Expect: Tariq sees only Tandoor's stock rows; **Karahi pot does not appear**; no Start day / Close day.

---

## Part B — A schema-1 hub meets the 01c cloud (plan task 39 step 5; 01a S28 b, 01c §6.17)

This plays the real upgrade on one database: a pre-01c cloud and hub run first, so the hub holds a **schema-1** config; then the 01c cloud takes over the same database and the old hub polls it.

B1. **Wipe** (top of this file). **Build the pre-01c code** from `main` in a separate worktree:

```sh
cd ~/pos && git worktree add ~/pos-main main
cd ~/pos-main && pnpm install && pnpm --filter @pos/client build
```

B2. **Pre-01c cloud** (T1) and seed (T3), from `~/pos-main`:

```sh
source ~/pos-manual/env.sh; POS=$HOME/pos-main cloud pnpm dev                    # T1
source ~/pos-manual/env.sh; POS=$HOME/pos-main cloud pnpm -s seed-demo | tee $M/seed.txt   # T3
pg -c "select max(version) from schema_migrations"                               # 0005
```

B3. **Pre-01c hub** (T2), from `~/pos-main`: write the hub config as e2e §4a, then `cd ~/pos-main/apps/hub && pnpm dev`; register **Gulberg** (e2e §4b), restart it, sign in and open the stock page (e2e §4c–§4d).

Expect: "Menu version N · checked just now" and the 01a stock rows (one row per tracked item). Note N.

```sh
hubsql "select snapshot_schema_version, config_version from branch_config"   # T3 (schema 1)
```

If the table or column name differs on `main`, run `hubsql "select name from sqlite_master where type='table'"` and report what is there.

B4. **Upgrade the cloud.** Stop T1 (Ctrl+C). Start the 01c cloud on the **same** database:

```sh
cd ~/pos && source ~/pos-manual/env.sh; cloud pnpm dev                          # T1
pg -c "select max(version) from schema_migrations"                               # 0006
```

Expect: the cloud starts; migration `0006` runs and backfills one stock item per tracked item.

B5. **The old hub polls the 01c cloud.** Leave the pre-01c hub (T2) running; wait up to 60 s (its poll interval), then reload the stock page.

Expect, all of:
- the poll is refused as **`schema_unsupported`** (a T2 log line, and the config status on the stock page says so);
- the **danger banner** shows on `/admin/stock` and in the config status;
- the **last config is kept**: the page still shows "Menu version N" (the N from B3) and the same stock rows; counts still save;
- nothing crashes: T2 keeps running, `curl -s $HUB/health | jq .data.status` → `"ready"`.

B6. **The 01c hub applies the same snapshot.** Stop T2. Start the 01c hub on the same data directory:

```sh
cd ~/pos/apps/hub && pnpm dev                                                    # T2
hubsql "select snapshot_schema_version, config_version from branch_config"       # T3, after the first poll
```

Expect: at boot the stored schema-1 body counts as no config, so the hub polls at once (AD-19) and applies the schema-2 snapshot: `snapshot_schema_version` 2, the banner gone after a reload, and the stock page now in the 01c form (one row per stock item, drawers listed under it). Items that were tracked in 01a appear as stock items of the same name.

B7. **Clean up:** stop T1 and T2; `cd ~/pos && git worktree remove ~/pos-main`.

---

## Reporting

Send the result of each step (A1–A8, B2–B6): **pass**, or **what I saw** (screen, what I did, what I saw, what I expected). Task 39 stays open until these results are in.
