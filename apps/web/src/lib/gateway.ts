/**
 * Thin BFF (Backend-For-Frontend) client for the gateway's REST API.
 *
 * The Next.js dashboard never talks to Postgres or the encryption vault
 * directly — the gateway is the single source of truth for workspaces,
 * members, roles, gateway keys, and provider credentials (including RBAC
 * and human-in-the-loop approvals for sensitive actions). This module is
 * the ONLY place that calls the gateway, and only ever runs server-side
 * (Next.js route handlers / server components), so the internal service
 * token below is never exposed to the browser.
 */

const GATEWAY_URL = process.env.GATEWAY_INTERNAL_URL || 'http://localhost:8080';
const INTERNAL_SERVICE_TOKEN = process.env.INTERNAL_SERVICE_TOKEN;

export class GatewayApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`Gateway request failed with status ${status}`);
  }
}

export interface GatewayResponse<T> {
  status: number;
  body: T;
}

export interface GatewayCallOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH';
  workspaceId: string;
  memberId?: string;
  body?: unknown;
}

/**
 * Calls a gateway route authenticated as the given workspace, using the
 * shared internal-service-token trust path (see the gateway's auth plugin).
 * `memberId`, when provided, is forwarded as `X-Member-Id` so the gateway's
 * existing RBAC/approval logic applies exactly as it does for any other
 * caller. Throws `GatewayApiError` on non-2xx responses; callers that need
 * to distinguish e.g. `202 pending_approval` from `201 created` should use
 * `callGatewayRaw` instead.
 */
export async function callGateway<T = unknown>(path: string, opts: GatewayCallOptions): Promise<T> {
  const { status, body } = await callGatewayRaw<T>(path, opts);
  if (status >= 400) {
    throw new GatewayApiError(status, body);
  }
  return body;
}

/** Like `callGateway`, but always resolves (never throws) with the raw status + body. */
export async function callGatewayRaw<T = unknown>(
  path: string,
  opts: GatewayCallOptions,
): Promise<GatewayResponse<T>> {
  if (!INTERNAL_SERVICE_TOKEN) {
    throw new Error(
      'INTERNAL_SERVICE_TOKEN is not configured. The dashboard cannot call the gateway without it.',
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${INTERNAL_SERVICE_TOKEN}`,
    'X-Workspace-Id': opts.workspaceId,
  };
  if (opts.memberId) headers['X-Member-Id'] = opts.memberId;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${GATEWAY_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });

  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;

  return { status: res.status, body: parsed as T };
}
