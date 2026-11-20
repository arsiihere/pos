import { z } from 'zod';
import { Minor, NonNegativeMinor } from '../bill/parts.js';

// 05 §6.17 / §6.19: a blind count's facts (B23: written only at the count, so expected is revealed only then).
export const countShape = {
  shift_id: z.string(),
  counted_minor: NonNegativeMinor,
  expected_minor: Minor,
  variance_minor: Minor,
  by_staff_id: z.string(),
};
