import { randomUUID } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { ChatCompletionRequestSchema, openAiError } from '../schemas/chat.js';
import { ProviderError } from '../adapters/types.js';
import { UnknownModelError } from '../services/chatService.js';
import { MissingCredentialError } from '../security/credentials.js';
import type { ChatService } from '../services/chatService.js';
import { scopedIdempotencyKey, type IdempotencyStore } from '../idempotency/store.js';
import { SpendingCapExceededError } from '../spending/enforcer.js';

export interface ChatRoutesOptions {
  chatService: ChatService;
  idempotency: IdempotencyStore;
}

interface CachedIdempotentResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

export const chatRoutes: FastifyPluginAsync<ChatRoutesOptions> = async (fastify, opts) => {
  fastify.post(
    '/v1/chat/completions',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const parsed = ChatCompletionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply
          .code(400)
          .send(openAiError(parsed.error.issues[0]?.message ?? 'Invalid request body.', 'invalid_request_error'));
        return;
      }
      const body = parsed.data;
      const workspace = request.workspace!;
      const memberId = request.member?.memberId ?? null;
      const traceId = randomUUID();
      let streamHijacked = false;

      // Idempotency: only meaningful for non-streaming requests, where we can
      // buffer and replay the exact prior response body/headers on retry.
      const idempotencyKeyHeader = request.headers['idempotency-key'];
      const idempotencyKey =
        typeof idempotencyKeyHeader === 'string' && idempotencyKeyHeader.length > 0
          ? scopedIdempotencyKey(workspace.id, idempotencyKeyHeader)
          : null;

      if (idempotencyKey && !body.stream) {
        const cached = await opts.idempotency.get(idempotencyKey);
        if (cached) {
          const parsedCached = JSON.parse(cached) as CachedIdempotentResponse;
          for (const [name, value] of Object.entries(parsedCached.headers)) {
            reply.header(name, value);
          }
          reply.header('x-idempotent-replay', 'true');
          return reply.code(parsedCached.statusCode).send(parsedCached.body);
        }
      }

      try {
        if (body.stream) {
          reply.hijack();
          streamHijacked = true;
          reply.raw.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
            'x-trace-id': traceId,
          });
          for await (const chunk of opts.chatService.completeStreaming(body, workspace, traceId, memberId)) {
            reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
          reply.raw.write('data: [DONE]\n\n');
          reply.raw.end();
          return;
        }

        const { response, routed, fallbackUsed, servedModel, cacheHit } = await opts.chatService.completeNonStreaming(
          body,
          workspace,
          traceId,
          memberId,
        );
        const headers: Record<string, string> = {
          'x-router-model': servedModel.id,
          'x-trace-id': traceId,
          'x-cache': cacheHit ? 'hit' : 'miss',
        };
        if (routed.complexityScore !== null) {
          headers['x-router-score'] = routed.complexityScore.toFixed(3);
        }
        if (fallbackUsed) {
          headers['x-router-fallback'] = 'true';
        }
        for (const [name, value] of Object.entries(headers)) {
          reply.header(name, value);
        }

        if (idempotencyKey) {
          const toCache: CachedIdempotentResponse = { statusCode: 200, body: response, headers };
          await opts.idempotency.set(idempotencyKey, JSON.stringify(toCache), 24 * 60 * 60);
        }

        return reply.code(200).send(response);
      } catch (err) {
        if (streamHijacked) {
          // Headers are already flushed; report the failure as an SSE event.
          const message = err instanceof Error ? err.message : 'Internal server error.';
          reply.raw.write(`data: ${JSON.stringify(openAiError(message, 'server_error'))}\n\n`);
          reply.raw.end();
          return;
        }
        reply.header('x-trace-id', traceId);
        return handleError(err, reply);
      }
    },
  );
};

function handleError(err: unknown, reply: import('fastify').FastifyReply) {
  if (err instanceof UnknownModelError) {
    return reply.code(400).send(openAiError(err.message, 'invalid_request_error', 'model_not_found'));
  }
  if (err instanceof MissingCredentialError) {
    return reply
      .code(400)
      .send(openAiError(err.message, 'invalid_request_error', 'missing_provider_credential'));
  }
  if (err instanceof SpendingCapExceededError) {
    return reply
      .code(429)
      .send(openAiError(err.message, 'rate_limit_error', 'spending_cap_exceeded'));
  }
  if (err instanceof ProviderError) {
    return reply.code(err.status >= 400 && err.status < 600 ? err.status : 502).send(
      openAiError(err.message, err.type),
    );
  }
  reply.log?.error?.(err);
  return reply.code(500).send(openAiError('Internal server error.', 'server_error'));
}
