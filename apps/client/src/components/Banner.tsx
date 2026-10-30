import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

// S35 i: UI kit Banner; data in, no API calls. Status always has an icon and a word (UI kit README).
export type BannerTone = 'ok' | 'warn' | 'danger' | 'info';

// Same icon per tone as 00's pages (apps/hub/src/lib/page.ts BANNER_ICONS: check, clock, alert, sync).
const ICONS: Record<BannerTone, ReactNode> = {
  ok: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  warn: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  danger: (
    <>
      <path d="M12 3.5L2.5 20h19L12 3.5z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.5v.01" />
    </>
  ),
  info: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.6L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.3 4.6L20 16" />
      <path d="M20 20v-4h-4" />
    </>
  ),
};

// `icon` replaces the tone's icon where a frame draws a specific one (cloud unreachable: wifi, 01a B04).
export function Banner({ tone, text, detail, icon }: { tone: BannerTone; text: string; detail?: string; icon?: IconName }) {
  return (
    <div className={`pos-banner pos-banner--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {icon !== undefined ? (
        <Icon name={icon} />
      ) : (
        <svg className="pos-icon" viewBox="0 0 24 24" aria-hidden="true">
          {ICONS[tone]}
        </svg>
      )}
      <p>
        {text}
        {detail !== undefined && <small>{detail}</small>}
      </p>
    </div>
  );
}
