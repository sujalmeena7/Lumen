import type { FetchLike, FetchLikeResponse } from '../adapters/types.js';

export interface MockResponseSpec {
  status?: number;
  json?: unknown;
  text?: string;
  sseLines?: string[]; // pre-built "data: ..." lines, joined with \n\n
}

function toResponse(spec: MockResponseSpec): FetchLikeResponse {
  const status = spec.status ?? 200;
  const sseBody = spec.sseLines
    ? spec.sseLines.map((l) => `data: ${l}\n\n`).join('')
    : undefined;

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => spec.json ?? {},
    text: async () => spec.text ?? (sseBody ?? JSON.stringify(spec.json ?? {})),
    body: sseBody
      ? (async function* () {
          yield new TextEncoder().encode(sseBody);
        })()
      : null,
  };
}

/** Builds a `FetchLike` that returns queued responses in order, one per call. */
export function createMockFetch(responses: MockResponseSpec[]): {
  fetchFn: FetchLike;
  calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }>;
} {
  const queue = [...responses];
  const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = [];
  const fetchFn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error('createMockFetch: no more queued responses');
    return toResponse(next);
  };
  return { fetchFn, calls };
}
