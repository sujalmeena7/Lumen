import type { FetchLikeResponse } from './types.js';

/**
 * Convert a fetch response body (async-iterable of bytes or a web ReadableStream)
 * into an async iterable of decoded string chunks. Handles both Node's
 * `Readable` (async-iterable) and the WHATWG `ReadableStream`.
 */
export async function* iterateBytes(
  body: FetchLikeResponse['body'],
): AsyncGenerator<Uint8Array, void, unknown> {
  if (!body) return;
  // WHATWG ReadableStream
  if (typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) yield value;
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  // Async-iterable (Node Readable / undici)
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    yield chunk as Uint8Array;
  }
}

/**
 * Parse an SSE stream into individual `data:` payload strings (excluding the
 * trailing "[DONE]" sentinel handling, which callers manage). Yields the raw
 * text after `data: ` for each event.
 */
export async function* parseSseData(
  body: FetchLikeResponse['body'],
): AsyncGenerator<string, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of iterateBytes(body)) {
    buffer += decoder.decode(bytes, { stream: true });
    let idx: number;
    // SSE events are separated by a blank line; process complete lines.
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) {
        yield line.slice(5).trim();
      }
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith('data:')) yield rest.slice(5).trim();
}
