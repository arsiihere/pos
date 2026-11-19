import { useEffect, useRef, useState } from 'react';
import { newUlid } from '../../../app/ulid';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { HubError } from '../kitchen-screens/api';
import { errorText } from '../kitchen-screens/KitchenScreens';
import type { BillDevice, BillRoute, BillScope, ConfigFloor, ConfigPrinter, ConfigZone, SetBillRoutePayload } from './api';

// 03c v1.0.13 §3.2, §6.6, §6.13 (05 row P-1, R-22; owner D-3 / PL-12: the existing Printers page patterns, no 05 design
// handoff): the "Bill printers" section — where bills, receipts and reports print. Rows: the default printer, the
// report printer (X / Z; none = the default), one row per device that can take a bill, one per active zone and floor (R-38:
// print-config lists them with their names), and an archived zone / floor or a lost id only while it still has a route
// (marked "archived", so it can be removed). A choice sends
// SetBillRoute at once; "No printer" sends printer_id null (removes the route). The section id is the target of the
// archive dialog's "Go to Bill printers".

export const BILL_SECTION_ID = 'bill-printers';


/** Devices that take a bill: not revoked, not a kitchen screen. */
export function billDevices(devices: readonly BillDevice[]): BillDevice[] {
  return devices.filter((d) => d.revoked_at === null && d.device_type !== 'kds');
}

/** "Ground · Patio": a zone name is unique only within its floor (01a), so the floor comes first (R-38). */
export function zoneLabel(zone: ConfigZone, floors: readonly ConfigFloor[]): string {
  const floor = floors.find((f) => f.floor_id === zone.floor_id);
  return floor === undefined ? zone.name : fill(t('billroutes.zone_in_floor'), { floor: floor.name, zone: zone.name });
}

/** "default:" → "All bills", "zone:Z1" → "Zone Garden" (the name, else the id). */
export function routeLabel(id: string, devices: readonly BillDevice[], zones: readonly ConfigZone[] = [], floors: readonly ConfigFloor[] = []): string {
  const at = id.indexOf(':');
  const scope = id.slice(0, at);
  const ref = id.slice(at + 1);
  if (scope === 'default') return t('billroutes.default');
  if (scope === 'report') return t('billroutes.report');
  if (scope === 'device') return fill(t('billroutes.device'), { name: devices.find((d) => d.device_id === ref)?.device_name ?? ref });
  if (scope === 'zone') {
    const zone = zones.find((z) => z.zone_id === ref);
    return zone === undefined ? fill(t('billroutes.zone'), { id: ref }) : zoneLabel(zone, floors);
  }
  const name = floors.find((f) => f.floor_id === ref)?.name;
  return fill(t(scope === 'zone' ? 'billroutes.zone' : 'billroutes.floor'), { id: name ?? ref });
}

interface RowSpec {
  scope: BillScope;
  ref_id: string;
  label: string;
  help?: string;
}


function Row({
  spec,
  route,
  printers,
  readOnly,
  busy,
  onPick,
}: {
  spec: RowSpec;
  route: BillRoute | undefined;
  printers: readonly ConfigPrinter[];
  readOnly: boolean;
  busy: boolean;
  onPick: (printerId: string | null) => void;
}) {
  const active = printers.filter((p) => p.archived_at === null);
  const current = route === undefined ? null : (printers.find((p) => p.printer_id === route.printer_id) ?? null);
  const none = spec.scope === 'default' ? t('billroutes.none_default') : spec.scope === 'report' ? t('billroutes.none_report') : t('billroutes.none_next');
  return (
    <div className="pos-list__row">
      <span className="pos-list__name">
        <strong>{spec.label}</strong>
        {spec.help !== undefined && <span>{spec.help}</span>}
      </span>
      {readOnly ? (
        <span>{current === null ? none : current.name}</span>
      ) : (
        <select
          className="pos-select"
          aria-label={spec.label}
          disabled={busy}
          value={route?.printer_id ?? ''}
          onChange={(e) => onPick(e.target.value === '' ? null : e.target.value)}
        >
          <option value="">{none}</option>
          {active.map((p) => (
            <option key={p.printer_id} value={p.printer_id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export function BillPrinters({
  routes,
  printers,
  zones,
  floors,
  loadDevices,
  readOnly,
  save,
}: {
  routes: readonly BillRoute[];
  printers: readonly ConfigPrinter[];
  /** print-config `zones` / `floors` (R-38) */
  zones: readonly ConfigZone[];
  floors: readonly ConfigFloor[];
  /** the devices read (00 §6.14); a refusal leaves the device rows out */
  loadDevices: () => Promise<readonly BillDevice[] | null>;
  /** absent manage-devices (00 M89): the choices are shown, not changed */
  readOnly: boolean;
  /** sends SetBillRoute with this command_id; resolves with the refusal, or null when saved */
  save: (payload: SetBillRoutePayload, commandId: string) => Promise<HubError | null>;
}) {
  const [devices, setDevices] = useState<readonly BillDevice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // 00 M47: a retry after a network failure resends the same command_id while the choice is unchanged.
  const pending = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    let live = true;
    void loadDevices().then((d) => {
      if (live && d !== null) setDevices(billDevices(d));
    });
    return () => {
      live = false;
    };
    // read once on open
  }, []);

  const route = (scope: BillScope, ref_id: string) => routes.find((r) => r.scope === scope && r.ref_id === ref_id);
  const rows: RowSpec[] = [
    { scope: 'default', ref_id: '', label: t('billroutes.default'), help: t('billroutes.default_help') },
    { scope: 'report', ref_id: '', label: t('billroutes.report'), help: t('billroutes.report_help') },
    ...devices.map((d): RowSpec => ({ scope: 'device', ref_id: d.device_id, label: fill(t('billroutes.device'), { name: d.device_name }) })),
    // a device route of a device the list does not show (revoked, kds) stays listed so it can be removed
    ...routes
      .filter((r) => r.scope === 'device' && !devices.some((d) => d.device_id === r.ref_id))
      .map((r): RowSpec => ({ scope: 'device', ref_id: r.ref_id, label: fill(t('billroutes.device'), { name: r.ref_id }) })),
    ...zones.filter((z) => !z.archived).map((z): RowSpec => ({ scope: 'zone', ref_id: z.zone_id, label: zoneLabel(z, floors) })),
    ...floors.filter((f) => !f.archived).map((f): RowSpec => ({ scope: 'floor', ref_id: f.floor_id, label: fill(t('billroutes.floor'), { id: f.name }) })),
    // an archived or unknown zone / floor stays listed while it has a route, so the route can be removed
    ...routes
      .filter((r) => (r.scope === 'zone' && !zones.some((z) => z.zone_id === r.ref_id && !z.archived)) || (r.scope === 'floor' && !floors.some((f) => f.floor_id === r.ref_id && !f.archived)))
      .map((r): RowSpec => ({ scope: r.scope, ref_id: r.ref_id, label: routeLabel(`${r.scope}:${r.ref_id}`, devices, zones, floors), help: t('billroutes.archived') })),
  ];

  const pick = async (spec: RowSpec, printerId: string | null) => {
    const payload: SetBillRoutePayload = { scope: spec.scope, ref_id: spec.ref_id, printer_id: printerId };
    const key = JSON.stringify(payload);
    if (pending.current?.key !== key) pending.current = { key, id: newUlid() };
    setProblem(null);
    setBusy(`${spec.scope}:${spec.ref_id}`);
    const refused = await save(payload, pending.current.id);
    setBusy(null);
    if (refused?.kind !== 'network') pending.current = null;
    if (refused !== null) setProblem(errorText(refused));
  };

  return (
    <section className="ad-stack" id={BILL_SECTION_ID}>
      <div className="ad-sec__h">
        <div>
          <h2>{t('billroutes.title')}</h2>
          <p>{t('billroutes.help')}</p>
        </div>
      </div>
      {problem !== null && (
        <p className="pos-field__error" role="alert">
          {problem}
        </p>
      )}
      <div className="pos-list pos-list--out">
        <div className="pos-list__head">
          <span>{t('billroutes.col.where')}</span>
          <span>{t('billroutes.col.printer')}</span>
        </div>
        {rows.map((spec) => (
          <Row
            key={`${spec.scope}:${spec.ref_id}`}
            spec={spec}
            route={route(spec.scope, spec.ref_id)}
            printers={printers}
            readOnly={readOnly}
            busy={busy !== null}
            onPick={(printerId) => void pick(spec, printerId)}
          />
        ))}
      </div>
    </section>
  );
}
