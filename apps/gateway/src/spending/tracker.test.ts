import { describe, it, expect } from 'vitest';
import { InMemorySpendingTracker, monthlySpendKey } from './tracker.js';

describe('monthlySpendKey', () => {
  it('produces a workspace-scoped key when memberId is null', () => {
    const key = monthlySpendKey('ws1', null, new Date('2025-03-15T00:00:00Z'));
    expect(key).toBe('spend:ws1:2025-03');
  });
  it('produces a member-scoped key when memberId is set', () => {
    const key = monthlySpendKey('ws1', 'mem1', new Date('2025-03-15T00:00:00Z'));
    expect(key).toBe('spend:ws1:mem1:2025-03');
  });
  it('pads single-digit months', () => {
    const key = monthlySpendKey('ws1', null, new Date('2025-01-05T00:00:00Z'));
    expect(key).toBe('spend:ws1:2025-01');
  });
});

describe('InMemorySpendingTracker', () => {
  it('starts at zero for an unknown key', async () => {
    const tracker = new InMemorySpendingTracker();
    expect(await tracker.getSpend('k')).toBe(0);
  });

  it('accumulates spend across multiple additions', async () => {
    const tracker = new InMemorySpendingTracker();
    await tracker.addSpend('k', 1.5);
    const total = await tracker.addSpend('k', 2.5);
    expect(total).toBe(4);
    expect(await tracker.getSpend('k')).toBe(4);
  });

  it('setSpend overwrites the running total (reconciliation)', async () => {
    const tracker = new InMemorySpendingTracker();
    await tracker.addSpend('k', 10);
    await tracker.setSpend('k', 3);
    expect(await tracker.getSpend('k')).toBe(3);
  });

  it('tracks separate keys independently', async () => {
    const tracker = new InMemorySpendingTracker();
    await tracker.addSpend('a', 5);
    await tracker.addSpend('b', 1);
    expect(await tracker.getSpend('a')).toBe(5);
    expect(await tracker.getSpend('b')).toBe(1);
  });
});
