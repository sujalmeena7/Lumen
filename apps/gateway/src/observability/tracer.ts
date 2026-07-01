/**
 * Structured tracing for the gateway's request lifecycle.
 *
 * A "trace" corresponds to one client request (one traceId). It is made up of
 * ordered "spans" representing each stage: auth, cache lookup, routing
 * decision, provider call, and final response. This lets an operator query a
 * single trace id and see exactly which stage/model failed and why.
 */
export type SpanName = 'auth' | 'cache' | 'route' | 'provider_call' | 'response';

export type SpanStatus = 'ok' | 'error';

export interface Span {
  name: SpanName;
  status: SpanStatus;
  startedAt: number; // epoch ms
  durationMs: number;
  attributes: Record<string, string | number | boolean | null>;
  error?: string;
}

export interface Trace {
  traceId: string;
  workspaceId: string;
  spans: Span[];
  createdAt: number;
}

/**
 * Records spans for a single trace. A fresh `TraceRecorder` is created per
 * request; spans are appended in order as the request moves through the
 * pipeline, then persisted via a `TraceStore`.
 */
export class TraceRecorder {
  private readonly spans: Span[] = [];

  constructor(
    readonly traceId: string,
    readonly workspaceId: string,
  ) {}

  /** Records a span given its start time and outcome. */
  record(
    name: SpanName,
    startedAt: number,
    attributes: Span['attributes'] = {},
    error?: string,
  ): void {
    this.spans.push({
      name,
      status: error ? 'error' : 'ok',
      startedAt,
      durationMs: Date.now() - startedAt,
      attributes,
      ...(error ? { error } : {}),
    });
  }

  /** Convenience: run a function, recording a span around it (success or failure). */
  async wrap<T>(
    name: SpanName,
    fn: () => Promise<T>,
    attributesOf: (result: T | undefined, error: unknown) => Span['attributes'] = () => ({}),
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.record(name, start, attributesOf(result, undefined));
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.record(name, start, attributesOf(undefined, err), message);
      throw err;
    }
  }

  toTrace(): Trace {
    return {
      traceId: this.traceId,
      workspaceId: this.workspaceId,
      spans: this.spans,
      createdAt: this.spans[0]?.startedAt ?? Date.now(),
    };
  }
}

/** Persists and retrieves traces for observability queries. */
export interface TraceStore {
  save(trace: Trace): Promise<void>;
  getByTraceId(traceId: string): Promise<Trace | null>;
}

/** In-memory trace store (tests / local demo). Bounded to avoid unbounded growth. */
export class InMemoryTraceStore implements TraceStore {
  private readonly traces = new Map<string, Trace>();
  private readonly order: string[] = [];
  constructor(private readonly maxTraces = 1000) {}

  async save(trace: Trace): Promise<void> {
    if (!this.traces.has(trace.traceId)) {
      this.order.push(trace.traceId);
      if (this.order.length > this.maxTraces) {
        const evict = this.order.shift();
        if (evict) this.traces.delete(evict);
      }
    }
    this.traces.set(trace.traceId, trace);
  }

  async getByTraceId(traceId: string): Promise<Trace | null> {
    return this.traces.get(traceId) ?? null;
  }
}
