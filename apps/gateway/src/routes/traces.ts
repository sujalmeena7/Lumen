import type { FastifyPluginAsync } from 'fastify';
import type { TraceStore } from '../observability/tracer.js';
import { openAiError } from '../schemas/chat.js';

export interface TraceRoutesOptions {
  traces: TraceStore;
}

/**
 * Observability endpoint: fetch the full lifecycle (auth/route/provider_call/
 * response spans) for a single request by its trace id. Scoped to the
 * authenticated workspace so one workspace cannot read another's traces.
 */
export const traceRoutes: FastifyPluginAsync<TraceRoutesOptions> = async (fastify, opts) => {
  fastify.get(
    '/v1/traces/:traceId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { traceId } = request.params as { traceId: string };
      const trace = await opts.traces.getByTraceId(traceId);
      if (!trace) {
        return reply.code(404).send(openAiError('Trace not found.', 'invalid_request_error'));
      }
      if (trace.workspaceId !== request.workspace!.id) {
        // Do not leak existence of another workspace's trace.
        return reply.code(404).send(openAiError('Trace not found.', 'invalid_request_error'));
      }
      return reply.code(200).send(trace);
    },
  );
};
