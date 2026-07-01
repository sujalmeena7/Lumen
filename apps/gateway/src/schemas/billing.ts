import { z } from 'zod';

export const SubscribeRequestSchema = z.object({
  /** Razorpay Plan id for the fixed-fee subscription component. */
  planId: z.string().min(1),
  /** Number of billing cycles; omit for an effectively unbounded subscription. */
  totalCount: z.number().int().positive().optional(),
  email: z.string().email(),
  name: z.string().max(200).optional(),
  /** Customer contact number, required by Razorpay's customer creation API. */
  contact: z.string().min(8).max(15).optional(),
});

export type SubscribeRequestBody = z.infer<typeof SubscribeRequestSchema>;
