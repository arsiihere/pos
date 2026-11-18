# 05 Billing — fiscal authority research (Pakistan)

| | |
|---|---|
| Status | **Research record (developer, 2026-11-17).** Input to `05-g0.md` (§3 K-14–K-18, §6 Q1, Q4, Q16–Q18, §6a). Not a spec; nothing here is approved. |
| Gathered | The owner's earlier research on PRA eIMS POS integration (2026-11-16, read from the PRA sites), and web searches on 2026-11-17 for SRB, KPRA, BRA and ICT. |
| Rule | **Every rate, threshold and time limit below is configuration data** that changes by notification. 05 stores them as data (authority, case, rate, effective date, notification ref), never in code. A value marked "ref not found" must be confirmed against the authority's notification before it is entered. |

## Owner direction (2026-11-17)

- The product is sold across Pakistan.
- Fiscalization is **not** PRA-specific: one fiscal **adapter port**, one adapter per authority — **PRA, SRB, KPRA, BRA, FBR-ICT** — plus **"none"**.
- Each branch picks its adapter (or "none").

## Who taxes restaurant service

| Territory | Authority | Law / note |
|---|---|---|
| Punjab | PRA (Punjab Revenue Authority), system **eIMS** | Punjab Sales Tax on Services Act 2012; eIMS Rules 2019 |
| Sindh | SRB (Sindh Revenue Board) | Sindh Sales Tax Special Procedure (Online Integration of Business) Rules 2022, updated 1 July 2024 |
| Khyber Pakhtunkhwa | KPRA, system **RIMS** | KPRA POS Regulations 2026 |
| Balochistan | BRA | — |
| Islamabad (ICT) | **FBR** | ICT (Tax on Services) Ordinance 2001; STGO 05 of 2026 (ICT) makes POS integration mandatory for listed (Table-1 / Table-2) services |
| Gilgit-Baltistan | — | reportedly no sales tax on services → adapter "none" |

## Rates (configuration data)

| Authority | Case | Rate | Ref | Date | Note |
|---|---|---|---|---|---|
| PRA | Restaurant service paid by debit / credit card, mobile wallet or QR | **5 %** (without input tax) | Notification PRA.32-24/2026/1313 | 19 Feb 2026 | |
| PRA | Restaurant service, any other payment (cash) | **16 %** | Notification PRA.32-24/2026/1313 | 19 Feb 2026 | |
| PRA | Mixed cash + card bill | **not stated** | — | — | some blogs say 8 %; not in the notification → ask (§6a A6) |
| SRB | Standard | **15 %** | ref not found (srb.gos.pk FAQ; SRB New POS API Document V1) | Jan 2026 (API document) | API `rateValue` allows 8 or 15 |
| SRB | Certain digital payments | **8 %** | ref not found (same sources) | Jan 2026 (API document) | which payments: confirm |
| KPRA | Card, wallet or QR | **6 %** (reported) | Finance Act 2026 | 13 May / 2 July 2026 | reported, confirm |
| KPRA | Where RIMS is integrated | **5 %** (reported) | Finance Act 2026 | 13 May / 2 July 2026 | reported, confirm |
| KPRA | Cash | **10 %** (reported) | Finance Act 2026 | 13 May / 2 July 2026 | reported, confirm |
| KPRA | Standard | **15 %** | ref not found | — | |
| BRA | Restaurants | **8 %** | ref not found | 3 Feb / 1 July 2026 | |
| BRA | Every POS linked to BRA's portal, no bill outside it | **4 %** | ref not found | 3 Feb / 1 July 2026 | not for hotel / club restaurants or franchises |
| FBR-ICT | Per service | mostly **15–16 %** | STGO 05 of 2026 (ICT) | 2026 | per-service table, confirm for restaurants |

## Thresholds and limits (configuration data)

| Authority | Item | Value | Ref | Date |
|---|---|---|---|---|
| PRA | Must integrate with eIMS | turnover ≥ **Rs 6 million** in any year since 2017-18; deadline 3 months after that year ends (6 months without an existing system) | eIMS Rules 2019 | 2019 (as read 2026-11-16) |
| PRA | Customer name + CNIC / NTN on the receipt | bill excluding tax **> Rs 50,000** | eIMS Rules 2019 r.6 | 2019 (as read 2026-11-16) |
| PRA | Offline catch-up | invoices issued outside eIMS while it is down are entered and transmitted **within one week** of the fault being fixed; the fault is reported **at once** | eIMS Rules 2019 r.8(3), r.8(1) | 2019 (as read 2026-11-16) |
| PRA | Credit (return / cancel) time limit | **none found** | — | — |
| SRB | Who must integrate | restaurants in hotels, franchise / international, multi-branch, in AC malls, selling online, or turnover **> Rs 5 million** | Sindh Online Integration Rules 2022 (updated 1 July 2024) | 1 July 2024 |
| SRB | POS vendor rules and penalties | reportedly from **1 July 2026** | ref not found | 1 July 2026 |
| KPRA | Who must use authorized POS software | **every** restaurant, hotel and food business | KPRA POS Regulations 2026 | 2026 |

## PRA (Punjab) — eIMS

- **Specification:** "Technical Specification Software Fiscal Device v1.2" (PRA user guide directory, reg.pra.punjab.gov.pk/NewsDirectory/UserGuide/…).
- **Two integration paths:** a **Windows-only** local fiscal service on `localhost:8524`, or the **cloud API** (spec §7.2.2):
  - sandbox `https://ims.pral.com.pk/ims/sandbox/api/Live/PostData`
  - production `https://ims.pral.com.pk/ims/production/api/Live/PostData`
  - auth `Authorization: Bearer <token>`; the production token is shown on the taxpayer's POS registration screen, **per POS ID**.
- **POS registration:** "All Business sectors will register their POS for each branch." Each POS has a unique counter name and a MAC / IP; type Cloud Based or Client Server. Unknown: may one POS ID serve many tablets (§6a A1; ask eims@pra.punjab.gov.pk).
- **IP whitelisting:** needed for servers **outside Pakistan**; email eims@pra.punjab.gov.pk with PNTN, business name, POS ID, server IP and server location.
- **Invoice fields:** `TotalSaleValue` (Σ item sale values, excluding tax and discount), `TotalTaxCharged`, `Discount`, `TotalBillAmount`. The worked example implies **tax after discount**. `PaymentMode`: 1 cash, 2 card, 3 gift voucher, 4 loyalty card, 5 mixed, 6 cheque. `InvoiceType` 3 = Credit (return or cancel), with `RefUSIN` = the original invoice.
- **Receipt (r.6):** description, quantity, unit price; amount excluding tax, tax, amount including tax; customer name + CNIC / NTN above the threshold; the **PRA invoice number** and a **QR** linking to `https://reg.pra.punjab.gov.pk/IMSFiscalReport/SearchPOSInvoice_Report.aspx?PRAInvNo=<n>`. QR size and logo rules: not found (§6a A3).
- **Offline:** r.8 as above; no provisional-number format found (§6a A2).
- **Penalties (s.48 entries 15–17):** Rs 0.4–1 M for bypassing eIMS; sealing; tampering up to 1 year in prison; Rs 0.5 M / 1 M for not issuing an invoice.
- **Vendors:** no vendor certification or approved list found.
- **Raast:** Circular 1/2026 makes a Raast QR account and its display mandatory. That QR is a **payment** QR, separate from the invoice QR.
- **Delivery platforms:** collecting agents since 19 Feb 2026, collecting 100 % of the tax. How the restaurant's POS records platform orders: not found (§6a A5).

## SRB (Sindh)

- **API:** POST JSON to `https://pos.srb.gos.pk/ePOSGateway/v1/SalesInvoiceService.api`; fields `posId`, `ntn`, `invoiceDateTime`, `invoiceType`, `invoiceId`, `rateValue`, `saleValue`, `taxAmount`, `QRCodeLink`. QR verification at apps.srb.gos.pk/InvoiceVerification/… . Source: SRB "New POS API Document V1" (Jan 2026), srb.gos.pk FAQ.

## KPRA (Khyber Pakhtunkhwa) — RIMS

- **API:** RIMS API (`https://kpra.gov.pk/docs/rims.html`). Recommended path: install the KPRA RIMS **Windows** utility and POST JSON to `http://localhost:3000/api/invoice`. QR built from `pos_id` + `invoice_no`. Whether a direct (non-utility) API exists: to confirm.

## BRA (Balochistan)

- Rates above. API not researched yet.

## FBR-ICT (Islamabad)

- STGO 05 of 2026 (ICT): POS integration mandatory for Table-1 / Table-2 service providers. API presumably FBR's POS / e-invoicing system; not researched yet.

## Design implications carried into 05-g0

1. **Rate = f(authority, payment class, integration status, effective date)** (payment class: cash vs digital = card, wallet, QR, online). A rate table per authority with effective dates and notification refs; never hard-coded (05-g0 K-15, Q16).
2. **The bill's tax is decided at payment**, when the method is known. Mixed payments need a rule per authority; PRA's is unknown, so the default is a configurable "higher rate" (Q4). Tax after discount (PRA example).
3. **Adapter port** (hub side, Linux): `submit(invoice) → { authority_invoice_no, qr_payload }`, `submitCredit(ref, invoice)`, a health check, and its own **outbox** with retry; invoices are buffered offline and re-sent (PRA: one-week catch-up; for the others the strictest known). The receipt prints "fiscal number pending" while offline; format to ask each authority (K-17, §6a A2).
4. **Transport:** PRA and SRB have HTTPS APIs. The hub can post directly from Pakistan with no whitelist; posting through the cloud (AWS me-central-1, outside Pakistan) needs PRA whitelisting and a static IP. KPRA recommends a Windows utility; the hub is Linux → direct API if one exists, else a Windows box (01e / hardware question) (K-16).
5. **POS ID granularity:** PRA registers a POS per counter; one hub = one POS ID, or one per cashier device? Ask the authorities (K-18, §6a A1).
6. **Receipt fields per adapter:** authority invoice number + verification QR; CNIC / NTN prompt above a per-authority threshold (Q18); separate from the Raast payment QR.
7. **Delivery-platform orders** may not be fiscalized by the restaurant (the platform is the collecting agent) → a per-order-type fiscal flag; ask the authority (Q17, §6a A5).
8. **"none" adapter** for unregistered or sub-threshold businesses and for Gilgit-Baltistan.

## Sources

- PRA eIMS Technical Specification Software Fiscal Device v1.2 — reg.pra.punjab.gov.pk/NewsDirectory/UserGuide/…
- PRA eIMS API — https://ims.pral.com.pk/ims/sandbox/api/Live/PostData, https://ims.pral.com.pk/ims/production/api/Live/PostData
- PRA invoice verification — https://reg.pra.punjab.gov.pk/IMSFiscalReport/SearchPOSInvoice_Report.aspx
- PRA Notification PRA.32-24/2026/1313 (19 Feb 2026); PRA eIMS Rules 2019; Punjab Sales Tax on Services Act 2012 s.48; PRA Circular 1/2026 (Raast)
- SRB FAQ — srb.gos.pk; SRB New POS API Document V1 (Jan 2026); SRB API — https://pos.srb.gos.pk/ePOSGateway/v1/SalesInvoiceService.api; verification — apps.srb.gos.pk/InvoiceVerification/…
- KPRA RIMS — https://kpra.gov.pk/docs/rims.html; KPRA POS Regulations 2026; KP Finance Act 2026
- ICT (Tax on Services) Ordinance 2001; FBR STGO 05 of 2026 (ICT)
- BRA notifications of 3 Feb / 1 July 2026 (ref not found)
