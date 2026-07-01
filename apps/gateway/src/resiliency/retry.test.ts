import { describe, it, expect, vi } from 'vitest';
import { requireModel } from '@router/core';
import { callWithResilience } from './retry.js';
import { ProviderError } from '../adapters/types.js';

const noopSleep = async () => {};

describe('callWithResilience', () => {
  it('returns on first success with no retries or fallback', async () => {
    const model = requireModel('gpt-4o-mini');
    const fn = vi.fn().mockResolvedValue('ok');
    const res = await callWithResilience(model, fn, { sleep: noopSleep });
    expect(res.result).toBe('ok');
    expect(res.model.id).toBe('gpt-4o-mini');
    expect(res.fallbackUsed).toBe(false);
    expect(res.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable error against the same model before succeeding', async () => {
    const model = requireModel('gpt-4o-mini');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('rate limited', 429, 'openai', true))
      .mockResolvedValueOnce('ok-after-retry');
    const res = await callWithResilience(model, fn, { sleep: noopSleep });
    expect(res.result).toBe('ok-after-retry');
    expect(res.fallbackUsed).toBe(false);
    expect(res.attempts).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('falls back to another model after exhausting retries on the primary', async () => {
    const model = requireModel('gpt-4o-mini');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('rate limited', 429, 'openai', true))
      .mockRejectedValueOnce(new ProviderError('rate limited', 429, 'openai', true))
      .mockResolvedValueOnce('ok-on-fallback');
    const res = await callWithResilience(model, fn, {
      sleep: noopSleep,
      retry: { maxAttemptsPerModel: 2, baseDelayMs: 1, maxFallbacks: 2 },
    });
    expect(res.result).toBe('ok-on-fallback');
    expect(res.fallbackUsed).toBe(true);
    expect(res.model.id).not.toBe('gpt-4o-mini');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a non-retryable error against the same model, but still falls back', async () => {
    const model = requireModel('gpt-4o-mini');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('bad request', 400, 'openai', false))
      .mockResolvedValueOnce('ok-on-fallback');
    const res = await callWithResilience(model, fn, { sleep: noopSleep });
    expect(res.result).toBe('ok-on-fallback');
    expect(res.fallbackUsed).toBe(true);
    // Only 1 attempt against the primary (non-retryable), then 1 against fallback.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the last error when all models and fallbacks are exhausted', async () => {
    const model = requireModel('gpt-4o-mini');
    const err = new ProviderError('down', 500, 'openai', true);
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      callWithResilience(model, fn, {
        sleep: noopSleep,
        retry: { maxAttemptsPerModel: 1, baseDelayMs: 1, maxFallbacks: 1 },
      }),
    ).rejects.toBe(err);
  });

  it('invokes onAttemptFailed for each failed attempt', async () => {
    const model = requireModel('gpt-4o-mini');
    const onAttemptFailed = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ProviderError('rate limited', 429, 'openai', true))
      .mockResolvedValueOnce('ok');
    await callWithResilience(model, fn, { sleep: noopSleep, onAttemptFailed });
    expect(onAttemptFailed).toHaveBeenCalledTimes(1);
    expect(onAttemptFailed.mock.calls[0]![0].id).toBe('gpt-4o-mini');
  });
});
