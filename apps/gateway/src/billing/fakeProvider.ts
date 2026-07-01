import { randomUUID } from 'node:crypto';
import type {
  BillingProvider,
  CreateCustomerInput,
  ReportUsageInput,
  SubscribeInput,
  SubscriptionInfo,
  SubscriptionStatus,
  UsageChargeResult,
  WebhookEventResult,
} from './types.js';

/**
 * In-memory fake `BillingProvider` for tests. Records calls so tests can
 * assert on reported usage/subscription lifecycle without a real Razorpay
 * account. `queueWebhookEvent` lets tests simulate inbound webhooks without
 * real Razorpay signatures.
 */
export class FakeBillingProvider implements BillingProvider {
  customers: CreateCustomerInput[] = [];
  subscriptions = new Map<string, SubscriptionInfo>();
  reportedUsage: ReportUsageInput[] = [];
  private webhookQueue: WebhookEventResult[] = [];

  async createCustomer(input: CreateCustomerInput): Promise<{ customerId: string }> {
    this.customers.push(input);
    return { customerId: `cus_fake_${randomUUID()}` };
  }

  async subscribe(input: SubscribeInput): Promise<SubscriptionInfo> {
    const info: SubscriptionInfo = { subscriptionId: `sub_fake_${randomUUID()}`, status: 'active' };
    this.subscriptions.set(info.subscriptionId, info);
    void input;
    return info;
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) this.subscriptions.set(subscriptionId, { ...sub, status: 'canceled' });
  }

  async reportUsage(input: ReportUsageInput): Promise<UsageChargeResult> {
    this.reportedUsage.push(input);
    return { orderId: `order_fake_${randomUUID()}`, amountPaise: input.amountPaise };
  }

  /** Test helper: queue a fake webhook event to be returned by verifyWebhook. */
  queueWebhookEvent(event: WebhookEventResult): void {
    this.webhookQueue.push(event);
  }

  verifyWebhook(_payload: string | Buffer, signature: string): WebhookEventResult {
    if (signature === 'invalid') {
      throw new Error('Invalid webhook signature.');
    }
    const next = this.webhookQueue.shift();
    if (!next) throw new Error('FakeBillingProvider: no queued webhook event');
    return next;
  }

  setSubscriptionStatus(subscriptionId: string, status: SubscriptionStatus): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) this.subscriptions.set(subscriptionId, { ...sub, status });
  }
}
