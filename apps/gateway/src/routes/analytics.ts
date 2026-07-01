import type { FastifyPluginAsync } from 'fastify';
import { AnalyticsSummaryQuerySchema } from '../schemas/analytics.js';
import { openAiError } from '../schemas/chat.js';
import type { RequestLogStore } from '../stores/types.js';

export interface AnalyticsRoutesOptions {
  requestLogs: RequestLogStore;
}

const DEFAULT_RANGE_DAYS = 30;

/**
 * ROI / "Money Saved" dashboard aggregation (Task 18).
 *
 * Aggregates `RequestLog` rows for the authenticated workspace over a time
 * range (defaults to the trailing 30 days): total requests, average latency,
 * cache-hit rate, headline Money Saved (baseline-if-premium-model vs actual
 * spend), and a per-model breakdown. Read-only and available to any
 * authenticated caller for the workspace (no member/role required — this is
 * not a sensitive action, same as viewing traces).
 */
export const analyticsRoutes: FastifyPluginAsync<AnalyticsRoutesOptions> = async (fastify, opts) => {
  fastify.get(
    '/v1/analytics/summary',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = AnalyticsSummaryQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply
          .code(400)
          .send(openAiError(parsed.error.issues[0]?.message ?? 'Invalid query parameters.', 'invalid_request_error'));
      }
      const workspace = request.workspace!;

      const until = parsed.data.until ? new Date(parsed.data.until) : new Date();
      const since = parsed.data.since
        ? new Date(parsed.data.since)
        : new Date(until.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);

      if (since > until) {
        return reply
          .code(400)
          .send(openAiError('"since" must be before "until".', 'invalid_request_error'));
      }

      const summary = await opts.requestLogs.summary(workspace.id, { since, until });
      return reply.code(200).send({
        range: { since: since.toISOString(), until: until.toISOString() },
        ...summary,
      });
    },
  );
};
