import { useSyncExternalStore } from 'react';
import type { CloudAdmin } from '../../api/cloud-admin';
import { Banner } from '../../components/Banner';
import { t } from '../../i18n';

// S53 (B04): one warn banner on every owner view while the cloud cannot be reached; saves are disabled
// until a call (the client's probe or the user's) gets an answer.
export function useCloudDown(api: CloudAdmin): boolean {
  return useSyncExternalStore(api.onCloudDown, api.cloudDown);
}

export function CloudDownBanner({ api }: { api: CloudAdmin }) {
  if (!useCloudDown(api)) return null;
  return <Banner tone="warn" text={t('common.cloud_down')} detail={t('common.cloud_down_body')} />;
}
