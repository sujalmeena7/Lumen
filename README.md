<div align="center">
  <img src="apps/web/src/app/icon.svg" alt="Lumen Logo" width="100" height="100" />
  <h1>Lumen</h1>
  <p><strong>A Highly Optimized, Cost-Aware AI Gateway & Dynamic Router</strong></p>
  <p>
    <a href="#key-features">Key Features</a> •
    <a href="#architecture">Architecture</a> •
    <a href="#quick-start">Quick Start</a> •
    <a href="#api-reference">API Reference</a> •
    <a href="#tech-stack">Tech Stack</a>
  </p>
</div>

---

**Lumen** is a production-grade, developer-first AI Gateway and routing engine designed to optimize latency, cost, and reliability across multiple LLM providers (including OpenAI, Anthropic, and Groq). 

By analyzing the heuristic complexity of incoming prompts, Lumen dynamically routes requests to the most cost-effective model that meets your quality requirements—saving up to 80% on inference costs without compromising output quality.

---

## ✨ Key Features

### 🧠 Intelligent Dynamic Routing
- **Cost-Aware Engine**: Calculates token costs dynamically using the `argmin` algorithm to find the absolute cheapest model that satisfies the query.
- **Complexity Scorer**: Evaluates prompt structure and context size to grade complexity, preventing expensive premium models from answering simple queries.
- **Resilient Fallbacks**: Auto-routes requests to equal-or-better candidate models if a preferred provider experiences rate-limits or outages.

### ⚡ Performance & Observability
- **Instant Caching**: Zero-cost, Redis-backed exact-match response cache (configurable per workspace).
- **SSE Stream Normalization**: A unified server-sent events stream format, normalizing OpenAI, Anthropic, and Groq streams into a single clean standard.
- **Granular Observability**: Structured request tracing (`/v1/traces/:id`) capturing the entire lifecycle of a call (Auth → Cache → Route → Provider Call → Cost Calculation).

### 🔒 Enterprise Governance & Security
- **Secure Key Vault**: Upstream provider API keys are protected using advanced envelope encryption at rest.
- **Granular Spending Caps**: Enforces hard monthly USD limits at both the workspace and individual team-member levels.
- **RBAC & Approvals**: Role-based access controls (Owner, Admin, Member) with built-in human-in-the-loop approval workflows for sensitive actions like credential rotation.
- **Idempotency Support**: Safely retry requests without double-billing or repeating executions using `Idempotency-Key` headers.

---

## 🎨 Premium Dashboard UI
Lumen features a modern, high-fidelity dashboard built with Next.js and Tailwind CSS v4, containing:
- **Liquid Navigation**: Framer Motion layout animations creating smooth transitions between tabs.
- **Analytics ROI Tracker**: Live calculations of total requests, latency trends, cache hit rates, and a headline **"Money Saved"** metric.
- **Interactive Controls**: Simple interfaces for generating gateway keys, managing provider credentials, and monitoring real-time spending caps with visual progress bars.

---

## 🏗️ Architecture

```
                       [ Client Request ]
                               │
                        ( Gateway Auth )
                               │
                     [ Redis Exact Cache ] ─── (Hit) ──> [ Return $0 Response ]
                               │ (Miss)
                     [ Complexity Scorer ]
                               │
                       [ argmin Router ] ─── (Failure) ──> [ Resilient Fallback ]
                               │
                 ┌─────────────┼─────────────┐
                 ▼             ▼             ▼
             [ OpenAI ]   [ Anthropic ]   [ Groq ]
                 │             │             │
                 └─────────────┼─────────────┘
                               ▼
                    [ Normalized Stream ]
                               │
                      ( Database Log )
                               │
                        [ Client Reply ]
```

---

## 🛠️ Tech Stack
- **Monorepo Structure**: `pnpm` workspaces separating `packages/core`, `packages/db`, `apps/gateway` (Fastify API), and `apps/web` (Next.js client).
- **Database**: PostgreSQL with Prisma ORM.
- **Cache**: Redis.
- **Frontend**: Next.js 16, React 19, Tailwind CSS v4, Framer Motion, Lucide icons.
- **Testing**: Vitest with unit/integration coverage for all routing, auth, and billing paths.

---

## 🚀 Quick Start

### 1. Prerequisites
Ensure you have **Node.js 20+**, **pnpm**, and **Docker** installed.

### 2. Installation & Setup
Clone the repository and install dependencies:
```bash
git clone https://github.com/sujalmeena7/Lumen.git
cd Lumen
pnpm install
pnpm approve-builds --all
```

Set up your environmental variables:
```bash
cp .env.example .env
```
Generate your secrets (for `MASTER_ENCRYPTION_KEY` and `INTERNAL_SERVICE_TOKEN`):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Initialize Services
Launch PostgreSQL and Redis via Docker:
```bash
docker compose up -d
```

Generate the Prisma client, run migrations, and seed the database:
```bash
pnpm --filter @router/db generate
pnpm --filter @router/db migrate
pnpm --filter @router/db seed
```
*Note: The seed script will print a developer email (`demo@router.dev`) and a default gateway API key.*

### 4. Run the Servers
Start the Fastify gateway:
```bash
pnpm dev:gateway
```

In a new terminal window, configure the client environment (`apps/web/.env.local`):
```env
SESSION_SECRET=some-32-character-random-string
GATEWAY_INTERNAL_URL=http://localhost:8080
INTERNAL_SERVICE_TOKEN=<same INTERNAL_SERVICE_TOKEN value as root .env>
```

Start the Next.js dashboard:
```bash
pnpm --filter @router/web dev
```

---

## 💻 API Usage

Interact with the Lumen Gateway endpoint using standard OpenAI-compatible libraries or `curl`:

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer <your-gateway-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "Write a quicksort function in Go."}
    ]
  }'
```

*Setting the model parameter to `"auto"` triggers Lumen's dynamic routing engine.*

---

## 📄 License
This project is licensed under the MIT License.
