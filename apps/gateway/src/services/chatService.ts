import { randomUUID } from 'node:crypto';
import {
  AUTO_MODEL,
  DEFAULT_WEIGHTS,
  computeCost,
  computeSavings,
  estimatePromptTokens,
  getModel,
  route,
  type ModelSpec,
  type NormalizedChatChunk,
  type NormalizedChatRequest,
  type NormalizedChatResponse,
  type RoutingWeights,
} from '@router/core';
import type { AdapterRegistry } from '../adapters/registry.js';
import type { ChatCallContext } from '../adapters/types.js';
import { CredentialResolver } from '../security/credentials.js';
import type { Config } from '../config.js';
import { providerBaseUrl } from '../config.js';
import type { RequestLogStore, WorkspaceInfo } from '../stores/types.js';
import { TraceRecorder, type TraceStore } from '../observability/tracer.js';
import { callWithResilience, DEFAULT_RETRY_OPTIONS, type RetryOptions } from '../resiliency/retry.js';
import { buildCacheKey, isCacheable, type ResponseCache } from '../cache/responseCache.js';
import { SpendingCapEnforcer, SpendingCapExceededError } from '../spending/enforcer.js';

export interface RoutedCall {
  model: ModelSpec;
  complexityScore: number | null;
  routerReason: string | null;
}

export interface ChatServiceDeps {
  adapters: AdapterRegistry;
  credentials: CredentialResolver;
  requestLogs: RequestLogStore;
  config: Config;
  traces: TraceStore;
  cache: ResponseCache;
  spendingCaps: SpendingCapEnforcer;
  retry?: Partial<RetryOptions>;
  cacheTtlSec?: number;
}

type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };
const ZERO_USAGE: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

/**
 * Decide which model serves this request: honor an explicit model id, or run
 * the heuristic router when the client requests the virtual "auto" model.
 */
export function resolveModel(
  req: NormalizedChatRequest,
  workspace: WorkspaceInfo,
): RoutedCall {
  if (req.model !== AUTO_MODEL) {
    const spec = getModel(req.model);
    if (!spec) {
      throw new UnknownModelError(req.model);
    }
    return { model: spec, complexityScore: null, routerReason: null };
  }
  const weights: RoutingWeights = workspace.routingWeights ?? DEFAULT_WEIGHTS;
  const decision = route(req.messages, { weights });
  return {
    model: decision.model,
    complexityScore: decision.complexity.score,
    routerReason: decision.reason,
  };
}

export class UnknownModelError extends Error {
  constructor(readonly modelId: string) {
    super(`Unknown model: ${modelId}`);
    this.name = 'UnknownModelError';
  }
}

export interface CompleteResult {
  response: NormalizedChatResponse;
  routed: RoutedCall;
  latencyMs: number;
  fallbackUsed: boolean;
  servedModel: ModelSpec;
  cacheHit: boolean;
}

export class ChatService {
  private readonly retryOptions: RetryOptions;

  constructor(private readonly deps: ChatServiceDeps) {
    this.retryOptions = { ...DEFAULT_RETRY_OPTIONS, ...deps.retry };
  }

  async callContext(workspaceId: string, model: ModelSpec): Promise<ChatCallContext> {
    const apiKey = await this.deps.credentials.resolve(workspaceId, model.provider);
    return { apiKey, baseUrl: providerBaseUrl(this.deps.config, model.provider) };
  }

  private weightsFor(workspace: WorkspaceInfo): RoutingWeights {
    return workspace.routingWeights ?? DEFAULT_WEIGHTS;
  }

  async completeNonStreaming(
    req: NormalizedChatRequest,
    workspace: WorkspaceInfo,
    traceId = randomUUID(),
    memberId: string | null = null,
  ): Promise<CompleteResult> {
    const tracer = new TraceRecorder(traceId, workspace.id);
    const overallStart = Date.now();

    // Spending cap check (Task 16): rejects BEFORE any routing/provider work
    // if the workspace (or acting member) has already hit its monthly cap.
    try {
      await this.deps.spendingCaps.assertWithinCap(workspace.id, memberId);
    } catch (err) {
      if (err instanceof SpendingCapExceededError) {
        tracer.record('response', overallStart, { status: 'blocked', reason: err.message });
        await this.deps.traces.save(tracer.toTrace());
        await this.deps.requestLogs.create({
          workspaceId: workspace.id,
          traceId,
          requestedModel: req.model,
          chosenModel: req.model,
          provider: 'openai', // no model was chosen; placeholder for the log schema
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          baselineCostUsd: 0,
          savedUsd: 0,
          latencyMs: Date.now() - overallStart,
          cacheHit: false,
          fallbackUsed: false,
          complexityScore: null,
          status: 'blocked',
          errorMessage: err.message,
        });
      }
      throw err;
    }

    let routed: RoutedCall;
    try {
      routed = await tracer.wrap(
        'route',
        async () => resolveModel(req, workspace),
        (result) => ({
          requestedModel: req.model,
          chosenModel: result?.model.id ?? null,
          complexityScore: result?.complexityScore ?? null,
        }),
      );
    } catch (err) {
      await this.deps.traces.save(tracer.toTrace());
      throw err;
    }

    // Exact-match cache lookup (Task 12): only for cacheable, non-"auto"-ambiguous
    // requests, scoped by workspace and keyed on the RESOLVED model + params.
    const cacheEligible = isCacheable(req) && !workspace.cacheDisabled;
    const cacheKey = cacheEligible ? buildCacheKey({
      workspaceId: workspace.id,
      resolvedModel: routed.model.id,
      request: req,
    }) : null;

    if (cacheKey) {
      const cacheStart = Date.now();
      const cached = await tracer.wrap(
        'cache',
        () => this.deps.cache.get(cacheKey),
        (result) => ({ hit: result !== null }),
      );
      if (cached) {
        const latencyMs = Date.now() - overallStart;
        tracer.record('response', overallStart, { status: 'success', cacheHit: true });
        await this.deps.traces.save(tracer.toTrace());
        await this.log(
          workspace.id,
          traceId,
          req,
          routed,
          routed.model,
          cached.usage,
          latencyMs,
          'success',
          false,
          undefined,
          true,
        );
        // Cache hits cost $0, so nothing to record against the spending cap.
        return {
          response: cached,
          routed,
          latencyMs,
          fallbackUsed: false,
          servedModel: routed.model,
          cacheHit: true,
        };
      }
      void cacheStart; // span already recorded via tracer.wrap
    }

    const providerCallStart = Date.now();
    try {
      const attempt = await callWithResilience(
        routed.model,
        async (model) => {
          const adapter = this.deps.adapters[model.provider];
          const ctx = await this.callContext(workspace.id, model);
          return adapter.chat(req, model, ctx);
        },
        {
          weights: this.weightsFor(workspace),
          promptTokens: estimatePromptTokens(req.messages),
          retry: this.retryOptions,
          onAttemptFailed: (model, attemptNum, error) => {
            const message = error instanceof Error ? error.message : String(error);
            tracer.record(
              'provider_call',
              providerCallStart,
              { provider: model.provider, model: model.id, attempt: attemptNum, failedModel: model.id },
              message,
            );
          },
        },
      );

      const response = attempt.result;
      tracer.record('provider_call', providerCallStart, {
        provider: attempt.model.provider,
        model: attempt.model.id,
        fallbackUsed: attempt.fallbackUsed,
        attempts: attempt.attempts,
      });

      // Populate the cache only when the resolved model actually served the
      // request without falling back (a fallback response was NOT generated
      // by `routed.model`, so caching it under that key would be misleading
      // on a subsequent identical request that might successfully hit the
      // primary model).
      if (cacheKey && !attempt.fallbackUsed) {
        await this.deps.cache.set(cacheKey, response, this.deps.cacheTtlSec ?? 3600);
      }

      const latencyMs = Date.now() - overallStart;
      tracer.record('response', overallStart, { status: 'success' });
      await this.deps.traces.save(tracer.toTrace());
      const cost = await this.log(
        workspace.id,
        traceId,
        req,
        routed,
        attempt.model,
        response.usage,
        latencyMs,
        'success',
        attempt.fallbackUsed,
      );
      await this.deps.spendingCaps.recordSpend(workspace.id, memberId, cost);
      return {
        response,
        routed,
        latencyMs,
        fallbackUsed: attempt.fallbackUsed,
        servedModel: attempt.model,
        cacheHit: false,
      };
    } catch (err) {
      const latencyMs = Date.now() - overallStart;
      const message = err instanceof Error ? err.message : String(err);
      tracer.record('response', overallStart, { status: 'error', failedModel: routed.model.id }, message);
      await this.deps.traces.save(tracer.toTrace());
      await this.log(
        workspace.id,
        traceId,
        req,
        routed,
        routed.model,
        ZERO_USAGE,
        latencyMs,
        'error',
        false,
        message,
      );
      throw err;
    }
  }

  async *completeStreaming(
    req: NormalizedChatRequest,
    workspace: WorkspaceInfo,
    traceId = randomUUID(),
    memberId: string | null = null,
  ): AsyncGenerator<NormalizedChatChunk, void, unknown> {
    const tracer = new TraceRecorder(traceId, workspace.id);
    const overallStart = Date.now();

    // Spending cap check (Task 16): same pre-flight check as non-streaming.
    await this.deps.spendingCaps.assertWithinCap(workspace.id, memberId);

    let routed: RoutedCall;
    try {
      routed = await tracer.wrap(
        'route',
        async () => resolveModel(req, workspace),
        (result) => ({
          requestedModel: req.model,
          chosenModel: result?.model.id ?? null,
          complexityScore: result?.complexityScore ?? null,
        }),
      );
    } catch (err) {
      await this.deps.traces.save(tracer.toTrace());
      throw err;
    }

    // Streaming can't be transparently retried mid-stream once bytes have been
    // sent to the client, so resilience for streams applies only to models
    // that fail BEFORE yielding their first chunk (connection/auth/rate-limit
    // errors surfaced on the initial request). Once streaming has started, we
    // let errors propagate as-is.
    const weights = this.weightsFor(workspace);
    const promptTokens = estimatePromptTokens(req.messages);
    const providerCallStart = Date.now();
    let usage: Usage = ZERO_USAGE;
    let servedModel = routed.model;
    let fallbackUsed = false;
    let startedStreaming = false;

    try {
      const attempt = await callWithResilience(
        routed.model,
        async (model) => {
          const adapter = this.deps.adapters[model.provider];
          const ctx = await this.callContext(workspace.id, model);
          const iterator = adapter.streamChat(req, model, ctx);
          const first = await iterator.next();
          return { iterator, first };
        },
        {
          weights,
          promptTokens,
          retry: this.retryOptions,
          onAttemptFailed: (model, attemptNum, error) => {
            const message = error instanceof Error ? error.message : String(error);
            tracer.record(
              'provider_call',
              providerCallStart,
              { provider: model.provider, model: model.id, attempt: attemptNum, failedModel: model.id },
              message,
            );
          },
        },
      );

      servedModel = attempt.model;
      fallbackUsed = attempt.fallbackUsed;
      startedStreaming = true;

      if (!attempt.result.first.done) {
        const chunk = attempt.result.first.value;
        if (chunk.usage) usage = chunk.usage;
        yield chunk;
      }
      for await (const chunk of attempt.result.iterator) {
        if (chunk.usage) usage = chunk.usage;
        yield chunk;
      }

      tracer.record('provider_call', providerCallStart, {
        provider: servedModel.provider,
        model: servedModel.id,
        fallbackUsed,
        attempts: attempt.attempts,
      });

      const latencyMs = Date.now() - overallStart;
      if (usage.total_tokens === 0) {
        const estPromptTokens = estimatePromptTokens(req.messages);
        usage = { prompt_tokens: estPromptTokens, completion_tokens: 0, total_tokens: estPromptTokens };
      }
      tracer.record('response', overallStart, { status: 'success' });
      await this.deps.traces.save(tracer.toTrace());
      const cost = await this.log(workspace.id, traceId, req, routed, servedModel, usage, latencyMs, 'success', fallbackUsed);
      await this.deps.spendingCaps.recordSpend(workspace.id, memberId, cost);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!startedStreaming) {
        tracer.record(
          'provider_call',
          providerCallStart,
          { provider: routed.model.provider, model: routed.model.id, failedModel: routed.model.id },
          message,
        );
      }
      const latencyMs = Date.now() - overallStart;
      tracer.record('response', overallStart, { status: 'error', failedModel: servedModel.id }, message);
      await this.deps.traces.save(tracer.toTrace());
      await this.log(
        workspace.id,
        traceId,
        req,
        routed,
        servedModel,
        usage,
        latencyMs,
        'error',
        fallbackUsed,
        message,
      );
      throw err;
    }
  }

  private async log(
    workspaceId: string,
    traceId: string,
    req: NormalizedChatRequest,
    routed: RoutedCall,
    servedModel: ModelSpec,
    usage: Usage,
    latencyMs: number,
    status: 'success' | 'error' | 'blocked',
    fallbackUsed: boolean,
    errorMessage?: string,
    cacheHit = false,
  ): Promise<number> {
    const { actualCost, baselineCost, saved } = computeSavings(
      servedModel,
      usage,
      this.deps.config.premiumBaselineModel,
    );
    await this.deps.requestLogs.create({
      workspaceId,
      traceId,
      requestedModel: req.model,
      chosenModel: servedModel.id,
      provider: servedModel.provider,
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      costUsd: cacheHit ? 0 : actualCost,
      baselineCostUsd: baselineCost,
      savedUsd: cacheHit ? baselineCost : saved,
      latencyMs,
      cacheHit,
      fallbackUsed,
      complexityScore: routed.complexityScore,
      status,
      errorMessage: errorMessage ?? null,
    });
    return cacheHit ? 0 : actualCost;
  }
}

// re-exported for convenience where cost math is needed alongside the service
export { computeCost };
