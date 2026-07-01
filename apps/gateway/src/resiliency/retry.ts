import type { ModelSpec, RoutingWeights } from '@router/core';
import { fallbackCandidates } from '@router/core';
import { ProviderError } from '../adapters/types.js';

export interface RetryOptions {
  /** Max attempts against the SAME model before giving up on it (including the first try). */
  maxAttemptsPerModel: number;
  /** Base delay for exponential backoff, in ms. */
  baseDelayMs: number;
  /** Max number of fallback models to try after the primary model's attempts are exhausted. */
  maxFallbacks: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttemptsPerModel: 2,
  baseDelayMs: 50,
  maxFallbacks: 2,
};

export interface AttemptResult<T> {
  result: T;
  model: ModelSpec;
  fallbackUsed: boolean;
  attempts: number;
}

export type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` against `primaryModel`, retrying on retryable `ProviderError`s
 * with exponential backoff. If the primary model's attempts are exhausted,
 * falls back to the next-best equivalent-or-higher-quality model (per the
 * argmin objective) and repeats, up to `maxFallbacks` models.
 *
 * Non-retryable errors abort immediately for the current model but still
 * allow falling back to another model (a 400 from one provider doesn't mean
 * a different provider would also fail).
 */
export async function callWithResilience<T>(
  primaryModel: ModelSpec,
  fn: (model: ModelSpec) => Promise<T>,
  opts: {
    weights?: RoutingWeights;
    catalog?: ModelSpec[];
    promptTokens?: number;
    retry?: Partial<RetryOptions>;
    sleep?: Sleep;
    onAttemptFailed?: (model: ModelSpec, attempt: number, error: unknown) => void;
  } = {},
): Promise<AttemptResult<T>> {
  const retryOpts = { ...DEFAULT_RETRY_OPTIONS, ...opts.retry };
  const sleep = opts.sleep ?? defaultSleep;

  const modelsToTry: ModelSpec[] = [primaryModel];
  let totalAttempts = 0;
  let lastError: unknown;

  for (let modelIndex = 0; modelIndex < modelsToTry.length; modelIndex++) {
    const model = modelsToTry[modelIndex]!;
    const isPrimary = modelIndex === 0;

    for (let attempt = 1; attempt <= retryOpts.maxAttemptsPerModel; attempt++) {
      totalAttempts++;
      try {
        const result = await fn(model);
        return { result, model, fallbackUsed: !isPrimary, attempts: totalAttempts };
      } catch (err) {
        lastError = err;
        opts.onAttemptFailed?.(model, attempt, err);
        const retryable = err instanceof ProviderError ? err.retryable : false;
        const hasMoreAttempts = attempt < retryOpts.maxAttemptsPerModel;
        if (retryable && hasMoreAttempts) {
          await sleep(retryOpts.baseDelayMs * 2 ** (attempt - 1));
          continue;
        }
        break; // exhausted retries (or non-retryable) for this model
      }
    }

    // Queue up fallback candidates the first time we exhaust the primary model.
    if (isPrimary && modelsToTry.length === 1) {
      const fallbacks = fallbackCandidates(primaryModel, {
        weights: opts.weights,
        catalog: opts.catalog,
        promptTokens: opts.promptTokens,
      }).slice(0, retryOpts.maxFallbacks);
      modelsToTry.push(...fallbacks);
    }
  }

  throw lastError;
}
