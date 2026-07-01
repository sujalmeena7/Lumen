# Implementation Plan — Dynamic Cost-Aware AI Router

## Problem Statement
Build a production-ready SaaS API gateway that is a drop-in replacement for the OpenAI API. It analyzes each incoming prompt, routes it to the most cost-effective capable model across multiple providers, handles reliability/caching/observability, isolates customer provider credentials, and monetizes via Stripe — proving value through a "Money Saved" dashboard.

## Requirements
- Scope: Full 4-phase platform.
- Backend: Node.js + TypeScript (Fastify).
- Providers: OpenAI, Anthropic, and Groq (Llama 3).
- Routing: Deterministic heuristic complexity scorer → model tier via `argmin(w1·Cost + w2·Latency − w3·Quality)`.
- Caching: Exact-match (Redis) first; semantic caching deferred (opt-in, thresholded).
- Infra: Docker Compose (Postgres + Redis); Stripe test mode; envelope encryption behind a KMS-ready `KeyVault` interface.
- Frontend: Next.js + Tailwind dashboard.
- Checkpoint: STOP for user review after Task 9 (DB schema + core proxy routing) before frontend work.

## Architecture
Monorepo (pnpm workspaces):
- `apps/gateway` — Fastify TS proxy (routing, caching, resilience, logging)
- `apps/web` — Next.js + Tailwind dashboard + auth + Stripe
- `packages/db` — Prisma schema, migrations, client
- `packages/core` — model catalog, pricing, complexity scorer, cost math (shared, unit-tested)
- `infra` — docker-compose (Postgres, Redis), env templates

Flow: Client (OpenAI SDK, base URL + gateway key) → Gateway [Auth+RateLimit → Exact-match cache → Heuristic scorer + argmin router → Provider adapters → Retries/Fallback/Idempotency → Trace+Cost logger] → OpenAI/Anthropic/Groq. Redis for cache/rate-limit/idempotency. Postgres for users/keys/creds/logs. Next.js dashboard reads Postgres + integrates Stripe.

Key research notes:
- `/v1/chat/completions` must accept standard OpenAI body and support SSE streaming (`stream: true`).
- Adapters translate OpenAI-shaped requests ↔ Anthropic Messages API / Groq, including streaming chunk shapes and usage/token accounting.
- Cost = input_tokens×input_price + output_tokens×output_price from static catalog; pre-flight token estimate via tokenizer, actuals from provider usage.
- "Money Saved" = baseline (all requests priced as premium baseline, e.g., GPT-4o) − actual chosen-model cost.

## Task Breakdown (test-driven, each demoable)

**Task 1:** Monorepo scaffold, tooling, local infra. pnpm workspace with the 4 packages; TS, ESLint/Prettier, Vitest; docker-compose (Postgres+Redis); `.env.example`; Fastify `/health` pinging DB+Redis. Tests: smoke + /health 200. Demo: `docker compose up` + `pnpm dev` → /health healthy.

**Task 2:** Prisma DB schema. Models: User, Workspace, WorkspaceMember(role), GatewayApiKey(hashed), ProviderCredential(encrypted blob + provider enum), RequestLog(model, tokens in/out, cost, baseline cost, latency, cache hit, status, trace id), SpendingCap. Gateway keys hashed; creds ciphertext only; indexes for workspace+time-range. Tests: migration + repo CRUD against test DB. Demo: migrate + seed demo workspace/key.

**Task 3:** `packages/core` model catalog, pricing, cost math. Catalog {provider,id,inputPrice,outputPrice,avgLatencyMs,qualityScore,tier} for GPT-4o/4o-mini, Claude Sonnet/Haiku, Llama3 8B/70B. Functions estimateTokens/computeCost/computeBaselineCost. Tests: cost math + token estimates vs fixtures. Demo: print savings for sample prompts.

**Task 4:** Gateway auth + rate limiting. Validate gateway API key (hash lookup) → resolve workspace; per-key Redis rate limit; OpenAI-style error bodies. Mandatory before any provider calls (network-exposed). Tests: valid pass, invalid/missing 401, over-limit 429. Demo: seeded key works; bad key rejected; flood → 429.

**Task 5:** Provider adapter abstraction + OpenAI adapter (non-streaming). `ProviderAdapter` interface chat(request)→normalizedResponse; OpenAI impl with usage parsing; decrypt provider cred server-side at call time, never log key. Tests: mapping + usage parsing with mocked HTTP. Demo: internal route returns normalized completion.

**Task 6:** OpenAI-compatible `/v1/chat/completions` (non-streaming passthrough). Accept standard OpenAI body (Zod-validated); forward to requested model via adapter; write RequestLog; OpenAI-shaped responses/errors. Tests: official OpenAI SDK pointed at our base URL gets valid completion. Demo: change only base URL + key in sample script.

**Task 7:** Streaming (SSE). Support stream:true with OpenAI-compatible data: chunks + [DONE]; accumulate usage for logging; backpressure-safe. Tests: chunk deltas assemble to full message; usage logged. Demo: streaming script prints tokens live.

**Task 8:** Anthropic + Groq adapters. Translate OpenAI-shaped requests to Anthropic Messages API and Groq incl. streaming normalization, role/system/stop-reason mapping → OpenAI finish reasons. Tests: per-adapter mapping (stream + non-stream) fixtures. Demo: same request served by GPT-4o-mini, Claude Haiku, Llama 3 by changing target model.

**Task 9:** Heuristic complexity scorer + routing engine (CORE). Signals: token length, code blocks, math/reasoning keywords, JSON/structured-output requests, multi-step indicators → complexity score. Router selects via argmin(w1·Cost+w2·Latency−w3·Quality) over eligible tier, weights configurable per workspace. Virtual "auto" model → router chooses; concrete model → respected. Expose x-router-model / x-router-score headers + RequestLog. Tests: table-driven simple→cheap, complex→frontier; weight changes shift selection. Demo: extraction prompt → Llama3/Haiku; multi-step reasoning → Sonnet/GPT-4o; headers show decision.

> **>>> STOP FOR USER REVIEW after Task 9 (DB schema + core proxy routing) before frontend. <<<**

**Task 10:** End-to-end tracing/observability. trace_id per request; structured span logs (auth→cache→route→provider→response) with model/latency/tokens/cost/outcome; record which model failed on error; queryable in RequestLog. Tests: failing call produces trace identifying failed model. Demo: query by request id → full lifecycle incl. failure.

**Task 11:** Resiliency — retries, fallbacks, idempotency. Retry w/ backoff; on 429/latency-spike/error fall back to equivalent-quality model (same/higher tier), cap attempts; idempotency keys (Redis) dedupe retried client requests; x-router-fallback header. Tests: primary 429 → served by fallback; dup idempotency key returns same result once. Demo: force primary failure → still succeeds via fallback; logs show switch.

**Task 12:** Exact-match caching (Redis). Hash normalized prompt+params; hit → cached response (cost 0, ms latency), flagged in logs; TTL + per-workspace opt-out; never cross-workspace; avoid unsafe caching of tool-call/streaming-only. Tests: identical → hit $0; param change → miss. Demo: repeat prompt → instant + $0 cache-hit log.

**Task 13:** Encrypted credential management (KMS-ready). `KeyVault` interface + envelope-encryption impl (data key encrypts creds, master key from env), store ciphertext only; add/rotate/delete endpoints. Provider keys decrypted only in gateway at call time, never returned/sent-to-models/logged; swappable to AWS KMS/Vault. Tests: encrypt/decrypt round-trip; stored value ciphertext; rotation re-encrypts. Demo: add OpenAI key via API stored encrypted → routing uses it; DB shows only ciphertext.

**Task 14:** RBAC, workspaces & approval config. Roles owner/admin/member; shared workspace context; config flag requiring human-in-the-loop approval for sensitive actions (cred/cap changes) modeled as pending-action record; role checks in middleware. Tests: member blocked from admin actions; approval-required action pending until approved. Demo: member denied key rotation; admin approves pending action.

**Task 15:** Stripe billing — subscriptions + usage metering. Stripe test-mode: subscription plans + usage metering reporting per-request cost/markup from RequestLog; idempotent webhook handling for subscription lifecycle. Tests: usage records correct quantities; webhook updates state. Demo: simulate usage → Stripe test dashboard shows metered records; subscribe/cancel reflected.

**Task 16:** Spending caps enforcement. Per-workspace/per-member monthly hard caps; gateway checks spend before/after each call, blocks (or degrades to cheapest model) when exceeded; running spend in Redis reconciled with Postgres. Tests: blocked once cap hit; reset at period boundary. Demo: low cap → succeeds until cap then clear "cap exceeded" error.

**Task 17:** Dashboard foundation — Next.js auth, workspaces, key management. Next.js + Tailwind; auth; workspace switching; UI to create gateway keys + manage provider creds (Task 13/14 APIs); never render secrets after creation (show once + copy). Tests: component/integration for key creation + role-gated views. Demo: sign in, create gateway key, add encrypted provider key from UI.

**Task 18:** ROI / "Money Saved" dashboard. Show total requests, avg latency + improvement vs baseline, cache-hit rate, headline Money Saved (baseline-if-GPT-4o vs actual), time-range filters, per-model breakdown; aggregate from RequestLog; precompute baseline per request. Tests: metric computations vs seeded fixtures; empty-state. Demo: generate traffic → dashboard shows requests/latency/cache/dollars saved.

**Task 19:** Spending caps + billing UI. Admin UI to set caps and view/manage Stripe subscription + usage vs caps. Tests: cap persists + enforces (ties Task 16); billing state renders. Demo: admin sets $1,500 cap, sees live usage vs cap.

**Task 20:** End-to-end wiring, hardening & docs. Full E2E test (client SDK → gateway → routed provider → logged → dashboard → Stripe metered); README/quickstart ("change your Base URL"); rate-limit/error hardening; seed/demo script. Tests: one E2E happy-path across all layers + basic load smoke. Demo: fresh `docker compose up` + quickstart runs a request end-to-end reflected in dashboard + Stripe test mode.

## Deferred (out of v1)
Semantic/embedding-based caching (opt-in, thresholded), multi-region deployment, managed-KMS swap.

## Execution Notes
- Begin with Task 1 and proceed sequentially; each task must be a working, tested, demoable increment.
- HARD STOP for user review after Task 9 before starting frontend (Task 17+).
- Flag any network-exposed endpoint without auth. Never log or expose provider credentials.
- Pin dependency versions; use Zod validation; parameterized DB access via Prisma.
