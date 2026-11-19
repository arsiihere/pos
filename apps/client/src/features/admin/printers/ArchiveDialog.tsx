import { useRef, useState } from 'react';
import { newUlid } from '../../../app/ulid';
import { Banner } from '../../../components/Banner';
import { BusyButton } from '../../../components/BusyButton';
import { Dialog } from '../../../components/Dialog';
import { t } from '../../../i18n';
import { fill } from '../../../i18n/en';
import type { HubError } from '../kitchen-screens/api';
import { errorText } from '../kitchen-screens/KitchenScreens';
import type { ConfigPrinter } from './api';

// 03c §3.2, §6.2; 03c-D02 (frame PrinterArchive): archive = SavePrinter { …the printer, archived: true }. Refused
// 409 CONFIG_IN_USE while an active station's output uses it (Q-18: an archived station already released it): the
// dialog names those stations (`used_by.ids`) and offers "Go to Station outputs"; ⚠️ 05 row P-1 (R-22): when only bill
// routes hold it (`used_by.entity: 'bill_route'`) it names the routes and offers "Go to Bill printers".

/** "Tandoor", "Tandoor and Fryer", "Tandoor, Fryer and Cold". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${t('common.and')} ${names.at(-1)!}`;
}

// 03c v1.0.13 §6.2 (05 row P-1, R-22): `used_by` is the stations, or else the bill routes as `<scope>:<ref_id>`.
interface InUse {
  entity: 'station' | 'bill_route';
  ids: string[];
}

function inUseOf(error: HubError): InUse | null {
  if (error.kind !== 'api' || error.code !== 'CONFIG_IN_USE') return null;
  const used = error.details['used_by'] as { entity?: unknown; ids?: unknown } | undefined;
  return { entity: used?.entity === 'bill_route' ? 'bill_route' : 'station', ids: Array.isArray(used?.ids) ? used.ids.map(String) : [] };
}

export function ArchiveDialog({
  printer,
  stationName,
  routeName,
  archive,
  onClose,
  onGoOutputs,
  onGoBillPrinters,
}: {
  printer: ConfigPrinter;
  stationName: (stationId: string) => string;
  /** a bill route id `<scope>:<ref_id>` as the section's row label */
  routeName: (routeId: string) => string;
  /** sends the archive with this command_id; resolves with the refusal, or null when archived */
  archive: (commandId: string) => Promise<HubError | null>;
  onClose: () => void;
  onGoOutputs: () => void;
  onGoBillPrinters: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [inUse, setInUse] = useState<InUse | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  // 00 M47: a retry after a network failure resends the same command_id.
  const commandId = useRef<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setBanner(null);
    commandId.current ??= newUlid();
    const refused = await archive(commandId.current);
    setBusy(false);
    if (refused?.kind !== 'network') commandId.current = null;
    if (refused === null) {
      onClose();
      return;
    }
    const used = inUseOf(refused);
    if (used !== null) setInUse(used);
    else setBanner(errorText(refused));
  };

  return (
    <Dialog
      title={fill(t('printers.archive_confirm'), { name: printer.name })}
      onClose={onClose}
      form={false}
      footer={
        inUse === null ? (
          <>
            <button type="button" className="pos-btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <BusyButton danger busy={busy} onClick={() => void confirm()}>
              {t('printers.archive')}
            </BusyButton>
          </>
        ) : (
          <>
            <button type="button" className="pos-btn" onClick={onClose}>
              {t('common.close')}
            </button>
            <button type="button" className="pos-btn pos-btn--primary" onClick={inUse.entity === 'bill_route' ? onGoBillPrinters : onGoOutputs}>
              {inUse.entity === 'bill_route' ? t('printers.go_bill_printers') : t('printers.go_outputs')}
            </button>
          </>
        )
      }
    >
      {inUse !== null && (
        <Banner
          tone="danger"
          text={
            inUse.entity === 'bill_route'
              ? fill(t('printers.in_use_routes'), { routes: joinNames(inUse.ids.map(routeName)) })
              : fill(t('printers.in_use'), { stations: joinNames(inUse.ids.map(stationName)) })
          }
        />
      )}
      {banner !== null && <Banner tone="danger" text={banner} />}
    </Dialog>
  );
}
