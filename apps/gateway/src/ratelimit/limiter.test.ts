import { describe, it, expect } from 'vitest';
import { InMemoryRateLimiter } from './limiter.js';

describe('InMemoryRateLimiter', () => {
  it('allows requests under the limit', async () => {
    const rl = new InMemoryRateLimiter({ max: 3, windowSec: 60 });
    const r1 = await rl.check('k');
    const r2 = await rl.check('k');
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);
  });

  it('blocks requests over the limit', async () => {
    const rl = new InMemoryRateLimiter({ max: 2, windowSec: 60 });
    await rl.check('k');
    await rl.check('k');
    const third = await rl.check('k');
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it('tracks separate keys independently', async () => {
    const rl = new InMemoryRateLimiter({ max: 1, windowSec: 60 });
    const a = await rl.check('a');
    const b = await rl.check('b');
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(true);
  });
});
