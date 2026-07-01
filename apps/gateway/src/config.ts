import { z } from 'zod';

const ConfigSchema = z.object({
  port: z.coerce.number().default(8080),
  host: z.string().default('0.0.0.0'),
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  databaseUrl: z.string().optional(),
  redisUrl: z.string().default('redis://localhost:6379'),
  masterEncryptionKey: z.string().optional(),
  rateLimitMax: z.coerce.number().default(60),
  rateLimitWindowSec: z.coerce.number().default(60),
  openaiBaseUrl: z.string().default('https://api.openai.com/v1'),
  anthropicBaseUrl: z.string().default('https://api.anthropic.com/v1'),
  groqBaseUrl: z.string().default('https://api.groq.com/openai/v1'),
  premiumBaselineModel: z.string().default('gpt-4o'),
  razorpayKeyId: z.string().optional(),
  razorpayKeySecret: z.string().optional(),
  razorpayWebhookSecret: z.string().optional(),
  usdToInrRate: z.coerce.number().default(83),
  /**
   * Shared secret for trusted first-party service-to-service calls (the
   * Next.js dashboard BFF calling the gateway on a logged-in user's behalf).
   * When present, `Authorization: Bearer <internalServiceToken>` combined
   * with an `X-Workspace-Id` header authenticates as that workspace WITHOUT
   * a per-workspace gateway key. Never exposed to browsers; only ever used
   * server-side (Next.js server actions / route handlers). RBAC via
   * `X-Member-Id` still applies identically to gateway-key auth.
   */
  internalServiceToken: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return ConfigSchema.parse({
    port: env.GATEWAY_PORT,
    host: env.GATEWAY_HOST,
    nodeEnv: env.NODE_ENV,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    masterEncryptionKey: env.MASTER_ENCRYPTION_KEY,
    rateLimitMax: env.RATE_LIMIT_MAX,
    rateLimitWindowSec: env.RATE_LIMIT_WINDOW_SEC,
    openaiBaseUrl: env.OPENAI_BASE_URL,
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL,
    groqBaseUrl: env.GROQ_BASE_URL,
    premiumBaselineModel: env.PREMIUM_BASELINE_MODEL,
    razorpayKeyId: env.RAZORPAY_KEY_ID,
    razorpayKeySecret: env.RAZORPAY_KEY_SECRET,
    razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    usdToInrRate: env.USD_TO_INR_RATE,
    internalServiceToken: env.INTERNAL_SERVICE_TOKEN,
  });
}

export function providerBaseUrl(config: Config, provider: string): string {
  switch (provider) {
    case 'openai':
      return config.openaiBaseUrl;
    case 'anthropic':
      return config.anthropicBaseUrl;
    case 'groq':
      return config.groqBaseUrl;
    default:
      throw new Error(`No base URL configured for provider: ${provider}`);
  }
}
