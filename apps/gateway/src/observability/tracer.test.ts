import { describe, it, expect } from 'vitest';
import { TraceRecorder, InMemoryTraceStore } from './tracer.js';

describe('TraceRecorder', () => {
  it('records successful spans with ok status', async () => {
    const tracer = new TraceRecorder('trace_1', 'ws_1');
    const result = await tracer.wrap('route', async () => 'chosen-model', (r) => ({ model: r ?? null }));
    expect(result).toBe('chosen-model');
    const trace = tracer.toTrace();
    expect(trace.spans).toHaveLength(1);
    expect(trace.spans[0]?.name).toBe('route');
    expect(trace.spans[0]?.status).toBe('ok');
    expect(trace.spans[0]?.attributes.model).toBe('chosen-model');
  });

  it('records failed spans with error status and message, and rethrows', async () => {
    const tracer = new TraceRecorder('trace_2', 'ws_1');
    await expect(
      tracer.wrap('provider_call', async () => {
        throw new Error('upstream boom');
      }),
    ).rejects.toThrow('upstream boom');

    const trace = tracer.toTrace();
    expect(trace.spans[0]?.status).toBe('error');
    expect(trace.spans[0]?.error).toBe('upstream boom');
  });

  it('preserves span order across multiple stages', async () => {
    const tracer = new TraceRecorder('trace_3', 'ws_1');
    await tracer.wrap('auth', async () => true);
    await tracer.wrap('route', async () => 'model-a');
    await tracer.wrap('provider_call', async () => 'ok');
    const trace = tracer.toTrace();
    expect(trace.spans.map((s) => s.name)).toEqual(['auth', 'route', 'provider_call']);
  });

  it('toTrace includes workspaceId and traceId', () => {
    const tracer = new TraceRecorder('trace_4', 'ws_42');
    const trace = tracer.toTrace();
    expect(trace.traceId).toBe('trace_4');
    expect(trace.workspaceId).toBe('ws_42');
  });
});

describe('InMemoryTraceStore', () => {
  it('saves and retrieves a trace by id', async () => {
    const store = new InMemoryTraceStore();
    const tracer = new TraceRecorder('t1', 'ws_1');
    await tracer.wrap('auth', async () => true);
    await store.save(tracer.toTrace());
    const found = await store.getByTraceId('t1');
    expect(found?.traceId).toBe('t1');
  });

  it('returns null for unknown trace id', async () => {
    const store = new InMemoryTraceStore();
    expect(await store.getByTraceId('nope')).toBeNull();
  });

  it('evicts the oldest trace once maxTraces is exceeded', async () => {
    const store = new InMemoryTraceStore(2);
    for (const id of ['a', 'b', 'c']) {
      const tracer = new TraceRecorder(id, 'ws_1');
      await tracer.wrap('auth', async () => true);
      await store.save(tracer.toTrace());
    }
    expect(await store.getByTraceId('a')).toBeNull(); // evicted
    expect(await store.getByTraceId('b')).not.toBeNull();
    expect(await store.getByTraceId('c')).not.toBeNull();
  });
});
