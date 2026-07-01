import type { SpendingCapStore, SpendingTracker } from './tracker.js';
import { monthlySpendKey } from './tracker.js';

export class SpendingCapExceededError extends Error {
  constructor(
    readonly scope: 'workspace' | 'member',
    readonly limitUsd: number,
    readonly currentUsd: number,
  ) {
    super(
      `Spending cap exceeded: ${scope} has spent ${formatUsd(currentUsd)} of a ${formatUsd(limitUsd)} monthly limit.`,
    );
    this.name = 'SpendingCapExceededError';
  }
}

/** Formats a USD amount with enough precision to show small-but-real costs (fractions of a cent). */
function formatUsd(n: number): string {
  if (n !== 0 && Math.abs(n) < 0.01) {
    return `$${n.toFixed(6)}`;
  }
  return `$${n.toFixed(2)}`;
}

/**
 * Enforces per-workspace and (optionally) per-member monthly spending caps
 * (Task 16). Checks BEFORE a provider call using the fast running-total
 * tracker (Redis in production), and records actual spend AFTER a successful
 * call. Both the workspace-wide cap and a per-member cap (if the acting
 * member is known) are checked; whichever is tightest applies.
 */
export class SpendingCapEnforcer {
  constructor(
    private readonly caps: SpendingCapStore,
    private readonly tracker: SpendingTracker,
  ) {}

  /**
   * Throws `SpendingCapExceededError` if either the workspace-wide or the
   * member-specific cap has already been reached. No-ops (allows the call)
   * when no cap is configured for a given scope.
   */
  async assertWithinCap(workspaceId: string, memberId: string | null): Promise<void> {
    const workspaceCap = await this.caps.getWorkspaceCap(workspaceId);
    if (workspaceCap) {
      const key = monthlySpendKey(workspaceId, null);
      const spent = await this.tracker.getSpend(key);
      if (spent >= workspaceCap.monthlyLimitUsd) {
        throw new SpendingCapExceededError('workspace', workspaceCap.monthlyLimitUsd, spent);
      }
    }

    if (memberId) {
      const memberCap = await this.caps.getMemberCap(workspaceId, memberId);
      if (memberCap) {
        const key = monthlySpendKey(workspaceId, memberId);
        const spent = await this.tracker.getSpend(key);
        if (spent >= memberCap.monthlyLimitUsd) {
          throw new SpendingCapExceededError('member', memberCap.monthlyLimitUsd, spent);
        }
      }
    }
  }

  /** Records spend against both the workspace-wide and member-specific totals. */
  async recordSpend(workspaceId: string, memberId: string | null, amountUsd: number): Promise<void> {
    if (amountUsd <= 0) return;
    await this.tracker.addSpend(monthlySpendKey(workspaceId, null), amountUsd);
    if (memberId) {
      await this.tracker.addSpend(monthlySpendKey(workspaceId, memberId), amountUsd);
    }
  }
}
