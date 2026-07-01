import { describe, it, expect } from 'vitest';
import { SpendingCapEnforcer, SpendingCapExceededError } from './enforcer.js';
import { InMemorySpendingTracker } from './tracker.js';
import type { SpendingCapRecord, SpendingCapStore } from './tracker.js';

function makeCapStore(caps: SpendingCapRecord[]): SpendingCapStore {
  return {
    getWorkspaceCap: async (workspaceId) =>
      caps.find((c) => c.workspaceId === workspaceId && c.memberId === null) ?? null,
    getMemberCap: async (workspaceId, memberId) =>
      caps.find((c) => c.workspaceId === workspaceId && c.memberId === memberId) ?? null,
    upsert: async () => {
      throw new Error('not used in this test');
    },
    list: async (workspaceId) => caps.filter((c) => c.workspaceId === workspaceId),
    remove: async () => true,
  };
}

describe('SpendingCapEnforcer', () => {
  it('allows a request when no cap is configured', async () => {
    const enforcer = new SpendingCapEnforcer(makeCapStore([]), new InMemorySpendingTracker());
    await expect(enforcer.assertWithinCap('ws1', null)).resolves.toBeUndefined();
  });

  it('allows a request under the workspace cap', async () => {
    const caps = makeCapStore([{ id: 'c1', workspaceId: 'ws1', memberId: null, monthlyLimitUsd: 100 }]);
    const tracker = new InMemorySpendingTracker();
    const enforcer = new SpendingCapEnforcer(caps, tracker);
    await enforcer.recordSpend('ws1', null, 50);
    await expect(enforcer.assertWithinCap('ws1', null)).resolves.toBeUndefined();
  });

  it('blocks a request once the workspace cap is reached', async () => {
    const caps = makeCapStore([{ id: 'c1', workspaceId: 'ws1', memberId: null, monthlyLimitUsd: 10 }]);
    const tracker = new InMemorySpendingTracker();
    const enforcer = new SpendingCapEnforcer(caps, tracker);
    await enforcer.recordSpend('ws1', null, 10);
    await expect(enforcer.assertWithinCap('ws1', null)).rejects.toBeInstanceOf(SpendingCapExceededError);
  });

  it('blocks a request once a per-member cap is reached, even if the workspace cap is not', async () => {
    const caps = makeCapStore([
      { id: 'c1', workspaceId: 'ws1', memberId: null, monthlyLimitUsd: 1000 },
      { id: 'c2', workspaceId: 'ws1', memberId: 'mem1', monthlyLimitUsd: 5 },
    ]);
    const tracker = new InMemorySpendingTracker();
    const enforcer = new SpendingCapEnforcer(caps, tracker);
    await enforcer.recordSpend('ws1', 'mem1', 5);
    await expect(enforcer.assertWithinCap('ws1', 'mem1')).rejects.toBeInstanceOf(SpendingCapExceededError);
    // A different member with no individual spend is unaffected.
    await expect(enforcer.assertWithinCap('ws1', 'mem2')).resolves.toBeUndefined();
  });

  it('recordSpend updates both workspace and member running totals', async () => {
    const caps = makeCapStore([]);
    const tracker = new InMemorySpendingTracker();
    const enforcer = new SpendingCapEnforcer(caps, tracker);
    await enforcer.recordSpend('ws1', 'mem1', 3);
    expect(await tracker.getSpend('spend:ws1:' + monthBucket())).toBe(3);
    expect(await tracker.getSpend('spend:ws1:mem1:' + monthBucket())).toBe(3);
  });

  it('recordSpend is a no-op for zero/negative amounts', async () => {
    const tracker = new InMemorySpendingTracker();
    const enforcer = new SpendingCapEnforcer(makeCapStore([]), tracker);
    await enforcer.recordSpend('ws1', null, 0);
    await enforcer.recordSpend('ws1', null, -5);
    expect(await tracker.getSpend('spend:ws1:' + monthBucket())).toBe(0);
  });

  it('error message includes scope, limit, and current spend', async () => {
    const caps = makeCapStore([{ id: 'c1', workspaceId: 'ws1', memberId: null, monthlyLimitUsd: 25 }]);
    const tracker = new InMemorySpendingTracker();
    const enforcer = new SpendingCapEnforcer(caps, tracker);
    await enforcer.recordSpend('ws1', null, 25);
    try {
      await enforcer.assertWithinCap('ws1', null);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SpendingCapExceededError);
      const e = err as SpendingCapExceededError;
      expect(e.scope).toBe('workspace');
      expect(e.limitUsd).toBe(25);
      expect(e.currentUsd).toBe(25);
      expect(e.message).toContain('$25.00');
    }
  });

  it('error message shows small-but-real fractional-cent amounts instead of "$0.00"', async () => {
    // Realistic for cheap models like Groq's Llama 3.1 8B: costs are
    // frequently well under a cent per request.
    const caps = makeCapStore([{ id: 'c1', workspaceId: 'ws1', memberId: null, monthlyLimitUsd: 0.0005 }]);
    const tracker = new InMemorySpendingTracker();
    const enforcer = new SpendingCapEnforcer(caps, tracker);
    await enforcer.recordSpend('ws1', null, 0.000503);
    try {
      await enforcer.assertWithinCap('ws1', null);
      expect.unreachable();
    } catch (err) {
      const e = err as SpendingCapExceededError;
      expect(e.message).not.toContain('$0.00 of a $0.00');
      expect(e.message).toContain('$0.000503');
      expect(e.message).toContain('$0.000500');
    }
  });
});

function monthBucket(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}
