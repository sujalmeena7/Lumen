import { z } from 'zod';

export const CreateGatewayKeyRequestSchema = z.object({
  name: z.string().min(1).max(100),
});

export type CreateGatewayKeyRequestBody = z.infer<typeof CreateGatewayKeyRequestSchema>;
