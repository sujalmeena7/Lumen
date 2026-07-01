# Dynamic Cost-Aware AI Router

See `PLAN.md` for the full implementation plan and task breakdown.

## Status: Tasks 1–19 complete (backend + dashboard + ROI/Money Saved view + billing/caps UI)

The full backend — routing engine, observability, resiliency, caching, RBAC,
billing, and spending caps — is implemented and tested, along with a
complete Next.js dashboard (auth, workspace switching, gateway key
management, provider credential management, the ROI/"Money Saved" Overview
page, and the billing + spending-cap admin UI). Remaining work is final
end-to-end hardening and docs polish (Task 20).

## What's implemented

- **Monorepo**: pnpm workspaces — `packages/core`, `packages/db`, `apps/gateway`.
- **`packages/core`**: model catalog (OpenAI/Anthropic/Groq), token estimation,
  cost math, "Money Saved" calculation, heuristic complexity scorer, the
  `argmin` routing engine, and same-tier-or-better fallback candidate selection.
- **`packages/db`**: Prisma schema (User, Workspace, WorkspaceMember,
  GatewayApiKey, ProviderCredential, RequestLog, SpendingCap, PendingApproval,
  WebhookEvent) + seed script.
- **`apps/gateway`**: Fastify server exposing an OpenAI-compatible
  `/v1/chat/completions` endpoint (streaming + non-streaming), gateway-key
  auth + rate limiting, provider adapters (OpenAI, Anthropic, Groq) with SSE
  normalization, envelope-encrypted credential storage, and the dynamic
  router wired end-to-end with request logging. Plus:
  - **Observability**: structured per-request tracing (`GET /v1/traces/:id`)
    capturing every stage (auth → cache → route → provider call → response).
  - **Resiliency**: retry-with-backoff on retryable provider errors, automatic
    fallback to an equivalent-or-better-quality model, and `Idempotency-Key`
    support to safely dedupe retried client requests.
  - **Caching**: exact-match response cache (Redis-backed) with per-workspace
    opt-out; cache hits cost $0 and report instantly.
  - **Credential management API**: `POST/GET/DELETE /v1/credentials` to
    add/rotate/list/remove provider keys (metadata-only reads, ciphertext-only
    storage).
  - **RBAC & approvals**: owner/admin/member roles (via `X-Member-Id`),
    sensitive actions (credential rotation/deletion, cap changes) can require
    human-in-the-loop approval (`GET/POST /v1/approvals`).
  - **Billing**: Razorpay subscriptions + usage-based charges (Razorpay has
    no metered-billing primitive like Stripe's Billing Meters, so accrued
    usage cost is periodically converted to INR and charged as a real
    Razorpay Order) via `/v1/billing/subscribe|cancel|status|webhook`.
  - **Spending caps**: per-workspace and per-member monthly hard caps
    (`/v1/spending-caps`, now including live current-month spend per cap),
    enforced pre-flight on every chat completion.
  - **Dashboard auth (Task 17)**: `POST /v1/auth/dev-login` — dev-grade,
    email-only identity (no password/OAuth) that finds-or-creates a `User`
    and returns their workspace memberships. This is intentionally NOT a
    production identity provider; it exists so the dashboard has something
    real to authenticate against while the gateway remains the single
    source of truth for workspace/member/role data.
  - **Gateway key management API**: `GET/POST /v1/keys`,
    `DELETE /v1/keys/:id` — list/create/revoke the customer-facing API keys
    used to call `/v1/chat/completions` (admin+ role required to
    create/revoke; plaintext shown once at creation).
  - **Analytics/ROI aggregation**: `GET /v1/analytics/summary` — aggregates
    `RequestLog` for the workspace over a time range into total requests,
    average latency (overall and excluding cache hits), cache-hit rate, and
    the headline "Money Saved" metric (baseline-if-premium-model vs actual
    spend) plus a per-model breakdown. Pure aggregation math
    (`computeAnalyticsSummary`) is shared by the in-memory and Prisma stores
    so it has exactly one tested implementation.
  - **Internal service auth**: the auth plugin also accepts
    `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>` + `X-Workspace-Id` as an
    alternative to a per-workspace gateway key. This exists solely for the
    Next.js dashboard's server-side BFF layer (never exposed to browsers) so
    it can call gateway APIs (keys, credentials, approvals) on a logged-in
    user's behalf without needing a plaintext gateway key (which, by design,
    only exists once at creation time). `X-Member-Id` still applies
    identically for RBAC on this path.
  - **Workspace member listing**: `GET /v1/workspaces/members` — lists every
    member of a workspace with email + role, used by the dashboard to let an
    admin pick a member when setting a per-member spending cap.
- **`apps/web`**: Next.js 16 + Tailwind dashboard (Tasks 17–19).
  - Dev-login (email only) → `iron-session` HTTP-only cookie session.
  - Workspace switcher (multi-workspace membership support).
  - Gateway key management UI: list, create (plaintext shown once, never
    again), revoke.
  - Provider credential management UI: list (metadata only), add/rotate,
    delete — surfaces the gateway's `pending_approval` state when a
    workspace requires human-in-the-loop approval for credential changes.
  - **ROI / "Money Saved" Overview page**: total requests, average latency
    (overall + excluding cache hits), cache-hit rate, headline Money Saved,
    time-range presets (24h/7d/30d/90d), and a per-model breakdown table.
    Empty-state guidance when a workspace has no traffic yet.
  - **Billing & Spending Caps page**: set/remove workspace-wide or
    per-member monthly spending caps with a live usage-vs-limit progress
    bar (highlighting caps that are over/near the limit); view current
    Razorpay subscription status; subscribe (given a Plan ID) or cancel,
    admin-only.
  - **Architecture**: the dashboard never touches Postgres or the envelope
    encryption vault directly. Every mutation goes through a thin
    server-side BFF (`apps/web/src/lib/gateway.ts`) that calls the gateway's
    real REST API, so RBAC, approvals, and encryption all have exactly one
    implementation (the gateway's), not a duplicated copy in the frontend.

## Running locally

```bash
pnpm install
pnpm approve-builds --all   # first time only, allows prisma/esbuild postinstall scripts

docker compose up -d        # Postgres + Redis

cp .env.example .env
# set MASTER_ENCRYPTION_KEY: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# set INTERNAL_SERVICE_TOKEN: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# set DATABASE_URL / REDIS_URL if different from defaults
# set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET to TEST-MODE credentials from the
# Razorpay Dashboard (the "rzp_test_..." key id) if you want to exercise
# billing routes for real; any non-empty placeholder also works for local
# routes that don't call Razorpay.

pnpm --filter @router/db generate
pnpm --filter @router/db migrate
pnpm --filter @router/db seed     # prints demo@router.dev + a demo gateway key

pnpm dev:gateway                  # starts the gateway on :8080
```

Then add a provider credential for your workspace via the dashboard (below)
or directly:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer <seeded-gateway-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"auto","messages":[{"role":"user","content":"Extract the date from: meeting on 2024-01-05"}]}'
```

### Running the dashboard

```bash
# apps/web/.env.local
SESSION_SECRET=<32+ char random string>
GATEWAY_INTERNAL_URL=http://localhost:8080
INTERNAL_SERVICE_TOKEN=<same value as INTERNAL_SERVICE_TOKEN in the root .env>
```

```bash
pnpm --filter @router/web dev      # starts the dashboard on :3000
```

Open `http://localhost:3000`, sign in with `demo@router.dev` (the seeded
user — dev-login has no password), and use the sidebar to switch workspaces,
manage gateway keys, manage provider credentials, and configure billing +
spending caps.

## Verification performed

- `pnpm -r typecheck` — clean across `packages/core`, `packages/db`,
  `apps/gateway`, `apps/web`.
- `npx vitest run` (gateway) — **178/178 tests passing**, covering: cost
  math, the complexity scorer, the argmin router (including
  weight-sensitivity and fallback candidate ordering), envelope encryption
  round-trips, gateway key hashing, rate limiting, the OpenAI/Anthropic
  adapters (mapping + streaming + error handling), full route-level
  integration tests for auth (gateway-key AND internal-service-token paths),
  `/health`, `/v1/chat/completions` (streaming/non-streaming, explicit model
  and `auto` routing, fallback, idempotency, caching), tracing/observability,
  the credential management API, gateway key management API, dev-login,
  workspace member listing, RBAC + approval workflows, Razorpay billing
  (subscribe/cancel/status/webhook idempotency), spending cap enforcement
  (including the current-spend-per-cap aggregation), and the analytics/ROI
  aggregation (both the pure math and the route, including empty-state and
  workspace-isolation cases).
- `npx vitest run` (web) — **24/24 tests passing**, covering key
  creation/list rendering, credential list/form (including the
  pending-approval response path), role-gating (admin-only actions hidden
  for members), the Overview page's empty/populated/error states and
  time-range filter, and the billing/spending-caps page (usage-vs-limit
  rendering, admin-only actions, subscribe/cancel visibility by
  subscription state).
- **Live end-to-end verification with real provider traffic AND a real
  Razorpay test-mode account** (this environment has Docker installed): ran
  `docker compose up`, migrated + seeded a real Postgres database, started
  the real gateway and dashboard, added a real Groq API key via the
  dashboard, created gateway keys, and:
  - Sent real requests through `/v1/chat/completions` (explicit model,
    `auto` routing, and repeated/varied prompts to exercise the exact-match
    cache) — actual Groq responses came back, real (fractions-of-a-cent)
    per-token costs were computed and logged, and the Overview page's
    `/v1/analytics/summary` correctly reflected total requests, latency,
    cache-hit rate, and a nonzero Money Saved figure from real token usage.
  - Set a real spending cap ($0.0005/month) via the dashboard, then drove
    real (non-cached, varied-prompt) Groq traffic until the gateway
    genuinely blocked a request with `spending_cap_exceeded` once
    cumulative real spend crossed the cap — confirmed via the dashboard's
    `/v1/spending-caps` response showing live `currentSpendUsd`.
  - Called `/v1/billing/subscribe`, `/v1/billing/status`, and
    `/v1/billing/cancel` against a real Razorpay **test-mode** account
    (`rzp_test_...` key + a real Plan created in the Razorpay test
    dashboard) — got back a real Razorpay customer id and subscription id,
    observed the real `incomplete` → `canceled` status transition, all
    persisted correctly in Postgres.
  - This run surfaced and fixed three real bugs that only appeared under a
    real Postgres/real-provider/real-Razorpay path (in-memory-store tests
    never exercised any of them): (1) the gateway had no mechanism to load
    `.env` into `process.env` at all; (2) `SpendingCapStore`'s Prisma
    implementation used `findUnique` with a `null` value for a nullable
    field in a compound unique index, which Prisma's query engine rejects
    at runtime — fixed by using `findFirst`/manual upsert for the
    workspace-wide (null-memberId) cap lookup; (3) `SpendingCapExceededError`
    and the analytics aggregation both rounded small-but-real dollar
    amounts (typical for cheap-model per-request costs) down to `$0.00` in
    user-facing messages — fixed by using higher-precision formatting for
    sub-cent amounts.

## Known follow-ups

- The dashboard's `dev-login` is intentionally not production-grade auth
  (no password, OAuth, or MFA) — fine for demoing this project, not for a
  real deployment.
- Razorpay webhook signature verification (`RAZORPAY_WEBHOOK_SECRET`) was
  not exercised against a real Razorpay-delivered webhook in this
  environment (no public URL to receive one); it is covered by route-level
  tests using the fake billing provider instead.
- Semantic/embedding-based caching, multi-region deployment, and a managed
  KMS backend for `KeyVault` are explicitly deferred (see `PLAN.md`).
