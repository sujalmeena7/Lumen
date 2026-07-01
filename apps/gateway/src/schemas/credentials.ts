import { z } from 'zod';

export const ProviderSchema = z.enum(['openai', 'anthropic', 'groq']);

export const CreateCredentialRequestSchema = z.object({
  provider: ProviderSchema,
  apiKey: z.string().min(1, 'apiKey is required'),
  label: z.string().max(100).optional(),
});

export type CreateCredentialRequestBody = z.infer<typeof CreateCredentialRequestSchema>;
