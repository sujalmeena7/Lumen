import type { FastifyPluginAsync } from 'fastify';
import { SubscribeRequestSchema } from '../schemas/billing.js';
import { openAiError } from '../schemas/chat.js';
import type { BillingProvider, SubscriptionStatus } from '../billing/types.js';
import type { WorkspaceStore } from '../stores/types.js';
import { ForbiddenError, MembershipRequiredError, requireRole } from '../rbac/roles.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Raw request body bytes, captured for Razorpay webhook signature verification. */
    rawBody?: Buffer;
  }
}

export interface BillingRoutesOptions {
  billing: BillingProvider;
  workspaces: WorkspaceStore;
  webhookEvents: { markProcessed(eventId: string, type: string): Promise<boolean> };
}

function requireMember(request: import('fastify').FastifyRequest) {
  if (!request.member) {
    throw new MembershipRequiredError(
      'This action requires an X-Member-Id header identifying the acting workspace member.',
    );
  }
  return request.member;
}

function handleRbacError(err: unknown, reply: import('fastify').FastifyReply) {
  if (err instanceof ForbiddenError) {
    return reply.code(403).send(openAiError(err.message, 'permission_error'));
  }
  if (err instanceof MembershipRequiredError) {
    return reply.code(401).send(openAiError(err.message, 'invalid_request_error'));
  }
  return null;
}

/**
 * Razorpay billing routes (Task 15): subscribe/cancel a workspace's plan and
 * view current billing status. Subscribing/canceling requires `admin`+ role.
 * Razorpay was chosen over Stripe because Stripe does not support Indian
 * merchant accounts for most business types.
 */
export const billingRoutes: FastifyPluginAsync<BillingRoutesOptions> = async (fastify, opts) => {
  // Razorpay requires the exact raw request bytes to verify the webhook
  // signature (HMAC-SHA256 over the raw body), so this route uses its own
  // content-type parser that captures the raw buffer instead of Fastify's
  // default JSON-parsing one.
  fastify.register(async (webhookScope) => {
    webhookScope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (request, body: Buffer, done) => {
        request.rawBody = body;
        done(null, body);
      },
    );

    webhookScope.post('/v1/billing/webhook', async (request, reply) => {
      const signature = request.headers['x-razorpay-signature'];
      if (typeof signature !== 'string') {
        return reply
          .code(400)
          .send(openAiError('Missing X-Razorpay-Signature header.', 'invalid_request_error'));
      }
      if (!request.rawBody) {
        return reply.code(400).send(openAiError('Missing request body.', 'invalid_request_error'));
      }

      let event;
      try {
        event = opts.billing.verifyWebhook(request.rawBody, signature);
      } catch {
        return reply.code(400).send(openAiError('Invalid webhook signature.', 'invalid_request_error'));
      }

      // Razorpay's own dedup header, per their idempotency guidance; falls
      // back to the id embedded in the parsed event if absent.
      const eventIdHeader = request.headers['x-razorpay-event-id'];
      const eventId = typeof eventIdHeader === 'string' && eventIdHeader ? eventIdHeader : event.id;

      const alreadyProcessed = await opts.webhookEvents.markProcessed(eventId, event.type);
      if (alreadyProcessed) {
        return reply.code(200).send({ received: true, duplicate: true });
      }

      await handleWebhookEvent(event, opts.workspaces);
      return reply.code(200).send({ received: true });
    });
  });

  fastify.post(
    '/v1/billing/subscribe',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = SubscribeRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(openAiError(parsed.error.issues[0]?.message ?? 'Invalid request body.', 'invalid_request_error'));
      }
      const workspace = request.workspace!;

      try {
        const member = requireMember(request);
        requireRole(member.role, 'admin');

        let customerId = workspace.razorpayCustomerId ?? null;
        if (!customerId) {
          const created = await opts.billing.createCustomer({
            workspaceId: workspace.id,
            email: parsed.data.email,
            name: parsed.data.name,
            contact: parsed.data.contact,
          });
          customerId = created.customerId;
          await opts.workspaces.updateBilling(workspace.id, { razorpayCustomerId: customerId });
        }

        const subscription = await opts.billing.subscribe({
          workspaceId: workspace.id,
          customerId,
          planId: parsed.data.planId,
          totalCount: parsed.data.totalCount,
        });

        await opts.workspaces.updateBilling(workspace.id, {
          razorpaySubscriptionId: subscription.subscriptionId,
          subscriptionStatus: subscription.status,
        });

        return reply.code(201).send({
          customerId,
          subscriptionId: subscription.subscriptionId,
          status: subscription.status,
        });
      } catch (err) {
        const handled = handleRbacError(err, reply);
        if (handled) return handled;
        throw err;
      }
    },
  );

  fastify.post(
    '/v1/billing/cancel',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const workspace = request.workspace!;
      try {
        const member = requireMember(request);
        requireRole(member.role, 'admin');

        if (!workspace.razorpaySubscriptionId) {
          return reply
            .code(400)
            .send(openAiError('Workspace has no active subscription.', 'invalid_request_error'));
        }
        await opts.billing.cancelSubscription(workspace.razorpaySubscriptionId);
        await opts.workspaces.updateBilling(workspace.id, { subscriptionStatus: 'canceled' });
        return reply.code(200).send({ status: 'canceled' });
      } catch (err) {
        const handled = handleRbacError(err, reply);
        if (handled) return handled;
        throw err;
      }
    },
  );

  fastify.get(
    '/v1/billing/status',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const workspace = request.workspace!;
      return reply.code(200).send({
        customerId: workspace.razorpayCustomerId ?? null,
        subscriptionId: workspace.razorpaySubscriptionId ?? null,
        status: (workspace.subscriptionStatus ?? 'none') as SubscriptionStatus,
      });
    },
  );
};

async function handleWebhookEvent(
  event: { type: string; data: unknown },
  workspaces: WorkspaceStore,
): Promise<void> {
  // Razorpay's subscription webhook payload is `payload.subscription.entity`
  // (see https://razorpay.com/docs/webhooks/payloads/subscriptions/), already
  // unwrapped to `event.data` by `verifyWebhook`'s caller-facing shape below.
  const data = event.data as {
    subscription?: { entity?: { id?: string; status?: string; notes?: Record<string, string> } };
  };
  const entity = data.subscription?.entity;
  if (!entity) return;

  const workspaceId = entity.notes?.workspaceId;
  if (!workspaceId || !entity.status) return;

  switch (event.type) {
    case 'subscription.activated':
    case 'subscription.authenticated':
    case 'subscription.charged':
    case 'subscription.completed':
    case 'subscription.updated':
    case 'subscription.pending':
    case 'subscription.halted':
    case 'subscription.paused':
    case 'subscription.resumed':
    case 'subscription.cancelled': {
      const status = mapRazorpayStatus(entity.status);
      await workspaces.updateBilling(workspaceId, {
        subscriptionStatus: status,
        razorpaySubscriptionId: entity.id,
      });
      return;
    }
    default:
      return; // ignore events we don't act on
  }
}

function mapRazorpayStatus(status: string): SubscriptionStatus {
  switch (status) {
    case 'active':
      return 'active';
    case 'authenticated':
      return 'trialing'; // authorized, awaiting first charge
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
