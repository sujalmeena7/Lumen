import { createHash } from 'node:crypto';
import type { BillingProvider } from './types.js';
import type { RequestLogStore, WorkspaceInfo } from '../stores/types.js';

export interface MeteringConfig {
  /**
   * USD-to-INR conversion rate used to convert accrued usage cost (computed
   * in USD by the router's cost math) into the INR paise amount charged via
   * Razorpay. Should be refreshed periodically from a live FX rate in
   * production; a static config value is used here for simplicity.
   */
  usdToInrRate: number;
}

/**
 * Reports a workspace's accrued usage cost as a real Razorpay charge
 * (Task 15). Usage is read from `RequestLog.costUsd` (already computed by the
 * router/cost math, in USD), converted to INR paise, and charged via
 * `BillingProvider.reportUsage` — which for Razorpay creates an actual Order,
 * since Razorpay has no Stripe-style "meter that auto-aggregates and bills
 * later" primitive.
 *
 * Idempotency: the charge for a given (workspace, period-bucket) uses a
 * deterministic idempotency key (Razorpay's `receipt` field), so re-running
 * the metering job for the same bucket (e.g. a retried cron tick) does not
 * double-charge the customer.
 */
export class MeteringService {
  constructor(
    private readonly billing: BillingProvider,
    private readonly requestLogs: RequestLogStore,
    private readonly config: MeteringConfig,
  ) {}

  /**
   * Charges usage accrued since `since` for a workspace with an active
   * Razorpay customer. No-ops if the workspace has no `razorpayCustomerId`
   * (not subscribed yet) or has zero cost to report.
   */
  async reportUsageSince(
    workspace: WorkspaceInfo,
    since: Date,
  ): Promise<{ chargedPaise: number; orderId: string | null } | null> {
    if (!workspace.razorpayCustomerId) return null;

    const costUsd = await this.requestLogs.sumCostSince(workspace.id, since);
    const amountPaise = Math.round(costUsd * this.config.usdToInrRate * 100);
    if (amountPaise <= 0) return { chargedPaise: 0, orderId: null };

    const bucketKey = `${workspace.id}:${since.toISOString().slice(0, 13)}`; // hour-bucketed
    const idempotencyKey = `meter-${createHash('sha256').update(bucketKey).digest('hex').slice(0, 24)}`;

    const result = await this.billing.reportUsage({
      customerId: workspace.razorpayCustomerId,
      amountPaise,
      idempotencyKey,
      description: `Usage charge for workspace ${workspace.id}`,
    });

    return { chargedPaise: result.amountPaise, orderId: result.orderId };
  }
}
