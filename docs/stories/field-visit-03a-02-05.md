# Field visit — Lake City branch — one visit for 03a, 02 and 05

| | |
|---|---|
| Purpose | Answer the owner questions for 03a (Timing Engine), 02 (Ordering + Tables) and 05 (Billing) in **one** visit, and observe one dinner rush. No spec is written before this. |
| Who to ask | **F** = father (owner), **M** = branch manager, **C** = head chef / tandoor wala, **K** = cashier, **OT** = an order taker |
| When | A Friday or Saturday; arrive 1 h before the dinner rush, stay through it (~3 h) |
| Bring | Phone (stopwatch, camera), this list, a printed menu, a notebook |
| Output | Answers written into `03a-g0.md` §4 (03a), `02-g0.md`, `05-g0.md` as **[owner]** rows |

Ask in plain words; the "decides" column is for the developer, not for the restaurant.

## A. 03a — Kitchen timing (F, C, M)

| # | Ask | Who | Decides |
|---|---|---|---|
| 1 | Walk me through every place food is cooked: tandoor(s), karahi stoves, paye degh, chanay, tawa, BBQ, fryer. At each: how many things cook at once? | C | station list; slot vs batch; capacity (D14) |
| 2 | At the karahi stoves: how many stoves, how many chefs in a rush? If one chef steps away, how many stoves go cold? | C, M | K7 / K8: capacity = stoves or chefs (§3 #5) |
| 3 | Paye and chanay: do they come from a degh cooked earlier? When the degh runs out, how long until the next is ready? Does leftover carry to the next day? | F, C | `stock_time_ms` vs `cook_time_ms`; `sold_out` vs `cook_fresh`; `carries_over`; batch program for the degh |
| 4 | Tandoor: roti on one, naan on the other — always? How many sit on the wall at once? How long does one take? Could both tandoors do both breads if you wanted a dine-in / takeaway split? | C, F | tandoor capacity; D23 split feasibility |
| 5 | Does a table's food go out together, or does whatever is ready go first? When a karahi is late and the rest is ready, what do you do today? | F, OT | D11 split-send default; `slip_threshold_ms` |
| 6 | Two chefs on one station: who takes which ticket? Head chef assigns, or first come first served? | C | lane claim (K7) pilot form |
| 7 | Who decides to switch a stove off or send a chef on break during a rush? How often per evening? | M | `manage-stations` permission; live capacity |
| 8 | Do you tell customers a time? How late is "too late" before someone must go and tell the customer (5 min? 10?) Who tells them? | F, OT | `slip_threshold_ms`; slip target |
| 9 | **At the peak, when the tandoor cannot keep up, who should wait: the table (sitting, karahi in front of them) or the takeaway customer standing at the counter?** | F | order-type weights (D3, D5); simulator finding §6 |
| 10 | Do you push a VIP or complaint order ahead? How often? Who may do it? | F | boost (D3) permission and defaults |
| 11 | Will every chef tap Start and Done on every ticket, with greasy hands, in a rush? (The owner's rule is "no tap, no job" — confirm with the chefs that they know.) | F, C | `completion_mode` default (§3 #10) |
| 12 | Where is food collected: one pass for everything, or tandoor separate? Who hands it to the waiter? | C, M | 01a v2.1 points; assembler |
| 13 | How many seconds from each station to each pass / counter? (measure, don't ask) | — | carry times (D8) |
| 14 | How many naan + roti per hour at the Friday peak? (count during the rush, and ask the tandoor wala his guess) | C, count | tandoor capacity vs demand (§6 overload) |
| 15 | When the kitchen is behind, how do you find out today, and what do you do (stop takeaway? add a man?) | M, F | pressure display and `station_overload` alert (D19–D21) |
| 15a | A plate comes back from a table ("more spicy", "not cooked enough", or a kitchen fault): what happens today — same plate fixed, or a new one? Does it jump the queue? Is it ever charged? | F, C | D28 defaults: fix vs remake, `adjust_time_ms`, `returns_boost` |

## B. 02 — Ordering and tables (M, OT)

| # | Ask | Who | Decides |
|---|---|---|---|
| 16 | How are floors and table groups organised? Does each order taker have fixed tables? How many waiters under each order taker? | M | zones, table owner, teams (Z1, Z2, R24) |
| 17 | Who takes orders: order takers only, or waiters too? | M | take-order permission; default roles |
| 18 | How often does a table order more after the first round? Do those orders need to be faster? | OT | `follow_up` flag and weight (D7) |
| 19 | Takeaway and parking: how many per evening? For parking, what identifies the car (number, colour, token)? | M, OT | order types; parking fields (02 Q8, Q9) |
| 20 | What is placed on the table before ordering (water, raita, salad)? What is always free? | M | zone stock (Z4), standing comp (C1) |
| 21 | Which bread goes with what, by default? (roti with karahi / salan / paye; raita with pulao; nothing with biryani?) | F, OT | "goes with" links (D12) |
| 22 | How often are tables moved, merged or split? | M | E2 AC6–8 in pilot or deferred |
| 23 | Does anyone record today that food reached the table? | OT | `mark-served`, estimated Served (G0-6) |
| 24 | Photos: menu card, deals, and how common are notes like "less spicy, no onion"? | — | 01c config; kitchen note chips |

## C. 05 — Billing (F, K)

| # | Ask | Who | Decides |
|---|---|---|---|
| 25 | **The pilot runs beside the current billing (R20). Will the cashier enter every bill twice? If not, what is the POS bill for during the pilot?** | F | 05 pilot scope (the biggest question) |
| 26 | How is a bill made today, is there a PRA receipt, and what happens when the internet is down? | F, K | OQ15 |
| 27 | Payment modes and rough share: cash, card machine, JazzCash / Easypaisa, Raast, bank transfer? | K | R7 payment list |
| 28 | Who gives a discount or a free item, and who approves it? | F, K | discount / comp kinds (N7, C2, C3) |
| 29 | How many cashiers per day; how is the drawer handed over; is cash counted by note; may an order taker collect cash for their own tables? | F, K | shifts (D21), 05 Q1, Q10 |
| 30 | Is the bill rounded (to 5 / 10 rupees)? Any tax or service charge on the bill? | F, K | rounding; `tax_enabled` |

## D. Observe during the rush (one hour, stopwatch)

- **20 orders end to end:** order taken → reached kitchen → cooking started → ready → at the pass → waiter picked up → on the table. Note each timestamp.
- **Peak numbers:** orders per hour, items per order, follow-up orders, **naan + roti per hour** (Q14).
- **Per station:** how many things actually cook at once; is any chef idle while another station queues; how many lanes at the karahi.
- **The pass:** how long food waits; how waiters are called (shout, bell); walk time from each zone to the pass and back (K10).
- **Tandoor:** how many breads on the wall at once; does the tandoor ever sit empty during the rush; does the tandoor wala know what comes next and how.
- **How a chef learns of an order today** (slip, shout, memory).
- **Hardware conditions:** heat, grease, wall sockets, Wi-Fi signal at each station and at the pass (for tablets and ESP32 buttons, 01e).
- **Cashier:** seconds per bill, payment mix, queue at the counter.
- **Photos:** menu card, today's bill / receipt, the current software's screen, the kitchen layout (for carry times).

## E. After the visit

1. Write the answers as **[owner]** rows in `03a-g0.md` §4 (and the 02 / 05 G0 files when they exist).
2. Feed the rush data into `03a-sim/tandoor_sim.py` (orders / h, items per order, tandoor capacity) and re-run §6 of `03a-g0.md`.
3. Only then start the 03a spec (`anthropic-skills:backend-spec-writer`).
