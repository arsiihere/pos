import { useEffect, useRef, useState } from 'react';
import { t } from '../../../i18n';
import { errorKey } from '../../../i18n/en';
import type { KdsApi } from '../contracts';
import { MESSAGE_MS, type ActionTimers } from './actions';

// 03b §3.2, §6.4 (K3; frames 03b-C07, 03b-B08): Give me more pulls the next line(s) early. `pulled: null` → "Nothing
// to pull right now" near the button for a few seconds; pulled lines arrive as FireDispatched (reason 'pulled').
// Not stage-guarded on the hub: a double tap sends one command, and a re-tap after a lost reply reuses its
// command_id (createKdsApi), so the hub never pulls a second line for one intent.

export function GiveMeMore({ api, stationId, up, timers }: { api: KdsApi; stationId: string; up: boolean; timers: ActionTimers }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const clear = useRef<unknown>(null);
  /** a pull in flight: a second tap before the reply sends nothing (a ref; the api keeps the id for a lost reply) */
  const inFlight = useRef(false);
  useEffect(() => () => void (clear.current !== null && timers.clearTimeout(clear.current)), [timers]);
  const show = (text: string | null) => {
    if (clear.current !== null) timers.clearTimeout(clear.current);
    clear.current = null;
    setMsg(text);
    if (text !== null) clear.current = timers.setTimeout(() => setMsg(null), MESSAGE_MS);
  };
  return (
    <>
      {msg !== null && (
        <div className="kl__msg c-mute" role="status">
          {msg}
        </div>
      )}
      <button
        type="button"
        className={busy ? 'btn busy' : 'btn'}
        disabled={!up || busy}
        aria-busy={busy}
        onClick={async () => {
          if (inFlight.current) return;
          inFlight.current = true;
          setBusy(true);
          const r = await api.giveMeMore({ station_id: stationId });
          inFlight.current = false;
          setBusy(false);
          if (r.ok) show(r.data.pulled === null ? t('kds.nothing_to_pull') : null);
          else show(r.error.kind === 'api' ? t(errorKey(r.error.code)) : null);
        }}
      >
        <svg className="ico" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 19V5" />
          <path d="M6 11l6-6 6 6" />
          <path d="M5 21h14" />
        </svg>
        {t('kds.give_more')}
      </button>
    </>
  );
}
