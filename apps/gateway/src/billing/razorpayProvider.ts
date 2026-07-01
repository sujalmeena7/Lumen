import { createHmac, timingSafeEqual } from 'node:crypto';
import Razorpay from 'razorpay';
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

/** Maps Razorpay subscription lifecycle states to our normalized status. */
function mapStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'active':
      return 'active';
    case 'authenticated':
      return 'trialing'; // authorization done, first charge pending
    case 'pending':
    case 'halted':
      return 'past_due';
    case 'cancelled':
    case 'expired':
      return 'canceled';
    case 'created':
    case 'completed':
      return 'incomplete';
    default:
      return 'none';
  }
}

export class RazorpayBillingProvider implements BillingProvider {
  private readonly razorpay: Razorpay;

  constructor(
    keyId: string,
    keySecret: string,
    private readonly webhookSecret: string,
  ) {
    this.razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }

  async createCustomer(input: CreateCustomerInput): Promise<{ customerId: string }> {
    const customer = await this.razorpay.customers.create({
      name: input.name ?? input.email,
      email: input.email,
      contact: input.contact,
      notes: { workspaceId: input.workspaceId },
    });
    return { customerId: customer.id };
  }

  async subscribe(input: SubscribeInput): Promise<SubscriptionInfo> {
    // Razorpay subscriptions do not accept a customer_id at creation time —
    // the customer is linked automatically once they complete the
    // authorization payment via the subscription's checkout short_url. We
    // instead embed workspaceId/customerId in `notes` so the webhook handler
    // (which receives the subscription entity, including notes) can
    // reconcile the event back to a workspace.
    const subscription = await this.razorpay.subscriptions.create({
      plan_id: input.planId,
      total_count: input.totalCount ?? 120, // ~10 years of monthly cycles if uncapped
      customer_notify: true,
      notes: { workspaceId: input.workspaceId, customerId: input.customerId },
    });
    return { subscriptionId: subscription.id, status: mapStatus(subscription.status) };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.razorpay.subscriptions.cancel(subscriptionId);
  }

  async reportUsage(input: ReportUsageInput): Promise<UsageChargeResult> {
    // Razorpay has no metered-billing primitive like Stripe's Billing Meters.
    // Their documented pattern for usage-based billing is to create a real
    // Order (a charge) against the customer directly. `receipt` doubles as
    // Razorpay's own idempotency key — a duplicate receipt is rejected.
    const order = await this.razorpay.orders.create({
      amount: input.amountPaise,
      currency: 'INR',
      receipt: input.idempotencyKey.slice(0, 40),
      notes: {
        customerId: input.customerId,
        description: input.description ?? 'Usage charge',
      },
    });
    return { orderId: order.id, amountPaise: Number(order.amount) };
  }

  verifyWebhook(payload: string | Buffer, signature: string): WebhookEventResult {
    const body = typeof payload === 'string' ? payload : payload.toString('utf8');
    const expected = createHmac('sha256', this.webhookSecret).update(body).digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(signature, 'hex');
    const valid =
      expectedBuf.length === receivedBuf.length && timingSafeEqual(expectedBuf, receivedBuf);
    if (!valid) {
      throw new Error('Invalid Razorpay webhook signature.');
    }

    const event = JSON.parse(body) as { event: string; payload: unknown; id?: string };
    // Razorpay webhook bodies don't always include a top-level "id"; the
    // caller (route layer) is expected to pass the `x-razorpay-event-id`
    // header value in for dedup, but we also fall back to a body-derived id.
    return { id: event.id ?? deriveEventId(body), type: event.event, data: event.payload };
  }
}

function deriveEventId(body: string): string {
  return createHmac('sha256', 'event-id-fallback').update(body).digest('hex').slice(0, 32);
}
