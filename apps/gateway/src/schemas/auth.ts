import { z } from 'zod';

export const DevLoginRequestSchema = z.object({
  email: z.string().email('A valid email is required'),
});

export type DevLoginRequestBody = z.infer<typeof DevLoginRequestSchema>;
