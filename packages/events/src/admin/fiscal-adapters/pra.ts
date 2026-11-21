import { z } from 'zod';

// 05 Appendix P.2: "PRA needs no adapter_settings (its settingsSchema accepts {} only)". Never a secret field: the
// token is a credential in the hub's fiscal_credentials (B22, H10-5). Shared by the cloud billing PUT (P0.9b) and
// the PRA adapter (task 30).
export const PraAdapterSettings = z.object({}).strict();
export type PraAdapterSettings = z.infer<typeof PraAdapterSettings>;
