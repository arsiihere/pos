import { z } from 'zod';

// 05 §4.5 row A-2 (H9-4), §3.15: the `none` adapter's settingsSchema — it takes no settings (`{}` only). Never a
// secret field (H10-5). Shared by the cloud billing PUT (P0.9b) and the hub adapter (task 28a).
export const NoneAdapterSettings = z.object({}).strict();
export type NoneAdapterSettings = z.infer<typeof NoneAdapterSettings>;
