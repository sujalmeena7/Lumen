/**
 * Billing abstraction (Task 15). Wraps Razorpay so the rest of the app
 * depends on a small, test-friendly interface rather than the Razorpay SDK
 * directly. Razorpay was chosen over Stripe because Stripe does not support
 * Indian merchant accounts for most business types.
 *
 * Model: each workspace maps 1:1 to a Razorpay Customer. Workspaces subscribe
 * to a fixed-fee Razorpay Plan/Subscription for the base fee. Razorpay has no
 * direct equivalent to Stripe's Billing Meters — usage-based billing is
 * Razorpay's guidance to use manually-triggered "Recurring Payments" against
 * a saved payment method, rather than an automatically-aggregated meter. So
 * `reportUsage` here actually CREATES a real charge (a Razorpay Order, paid
 * via the customer's saved token) for the accrued usage cost, rather than
 * just recording a number for Razorpay to aggregate later.
 */
export type SubscriptionStatus =
  | 'none'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete';

export interface CreateCustomerInput {
  workspaceId: string;
  email: string;
  name?: string;
  /** Contact number, required by Razorpay's customer creation API. */
  contact?: string;
}

export interface SubscribeInput {
  workspaceId: string;
  customerId: string;
  /** Razorpay Plan id for the fixed-fee subscription component. */
  planId: string;
  /** Number of billing cycles; omit for an until-canceled subscription. */
  totalCount?: number;
}

export interface SubscriptionInfo {
  subscriptionId: string;
  status: SubscriptionStatus;
}

export interface ReportUsageInput {
  /** Razorpay Customer id to charge for accrued usage. */
  customerId: string;
  /** Amount to charge, in paise (INR's smallest unit; 1 INR = 100 paise). */
  amountPaise: number;
  /** Idempotency key so retried reports don't double-charge. */
  idempotencyKey: string;
  /** Human-readable description shown on the Razorpay order/invoice. */
  description?: string;
}

export interface UsageChargeResult {
  /** Razorpay Order id created for this usage charge. */
  orderId: string;
  amountPaise: number;
}

export interface WebhookEventResult {
  id: string;
  type: string;
  data: unknown;
}

export interface BillingProvider {
  createCustomer(input: CreateCustomerInput): Promise<{ customerId: string }>;
  subscribe(input: SubscribeInput): Promise<SubscriptionInfo>;
  cancelSubscription(subscriptionId: string): Promise<void>;
  /** Creates a real charge (Razorpay Order) for the workspace's accrued usage cost. */
  reportUsage(input: ReportUsageInput): Promise<UsageChargeResult>;
  /** Verifies the webhook signature (HMAC-SHA256) and parses the event. Throws on mismatch. */
  verifyWebhook(payload: string | Buffer, signature: string): WebhookEventResult;
}
