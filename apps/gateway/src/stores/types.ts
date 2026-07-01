import type { Provider } from '@router/core';
import type { EncryptedSecret } from '../security/vault.js';

export interface ResolvedKey {
  workspaceId: string;
  keyId: string;
}

export interface WorkspaceInfo {
  id: string;
  name: string;
  routingWeights?: { cost: number; latency: number; quality: number } | null;
  /** Per-workspace opt-out for exact-match response caching (Task 12). */
  cacheDisabled?: boolean;
  /** When true, sensitive actions require human-in-the-loop approval (Task 14). */
  requireApprovalForSensitiveActions?: boolean;
  /** Razorpay billing fields (Task 15). */
  razorpayCustomerId?: string | null;
  razorpaySubscriptionId?: string | null;
  subscriptionStatus?: 'none' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete';
}

export type Role = 'owner' | 'admin' | 'member';

export interface MemberInfo {
  memberId: string;
  workspaceId: string;
  userId: string;
  role: Role;
}

/** Resolves a workspace member's role, used by the RBAC middleware (Task 14). */
export interface MembershipStore {
  get(workspaceId: string, memberId: string): Promise<MemberInfo | null>;
  /** Lists every member of a workspace, with the underlying user's email (Task 19: per-member cap UI). */
  listForWorkspace(workspaceId: string): Promise<MemberWithEmail[]>;
}

export interface MemberWithEmail extends MemberInfo {
  email: string;
}

export type SensitiveActionType =
  | 'credential_rotate'
  | 'credential_delete'
  | 'spending_cap_change';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface PendingApprovalRecord {
  id: string;
  workspaceId: string;
  actionType: SensitiveActionType;
  requestedById: string;
  payload: unknown;
  status: ApprovalStatus;
  reviewedById: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface CreatePendingApprovalInput {
  workspaceId: string;
  actionType: SensitiveActionType;
  requestedById: string;
  payload: unknown;
}

/** Stores sensitive actions pending human-in-the-loop approval. */
export interface ApprovalStore {
  create(input: CreatePendingApprovalInput): Promise<PendingApprovalRecord>;
  get(workspaceId: string, approvalId: string): Promise<PendingApprovalRecord | null>;
  list(workspaceId: string, status?: ApprovalStatus): Promise<PendingApprovalRecord[]>;
  /** Marks the approval reviewed (approved/rejected); returns the updated record. */
  review(
    workspaceId: string,
    approvalId: string,
    status: 'approved' | 'rejected',
    reviewedById: string,
  ): Promise<PendingApprovalRecord | null>;
}

export interface StoredCredential extends EncryptedSecret {
  provider: Provider;
}

export interface CredentialSummary {
  provider: Provider;
  label: string | null;
  createdAt: Date;
  rotatedAt: Date | null;
}

export interface RequestLogInput {
  workspaceId: string;
  traceId: string;
  requestedModel: string;
  chosenModel: string;
  provider: Provider;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  baselineCostUsd: number;
  savedUsd: number;
  latencyMs: number;
  cacheHit: boolean;
  fallbackUsed: boolean;
  complexityScore?: number | null;
  status: 'success' | 'error' | 'blocked';
  errorMessage?: string | null;
}

/** Looks up gateway API keys by their SHA-256 hash and resolves the workspace. */
export interface KeyStore {
  findByHash(keyHash: string): Promise<ResolvedKey | null>;
  touchLastUsed(keyId: string): Promise<void>;
  /** Creates a new gateway key for a workspace; stores only the hash. */
  create(input: {
    workspaceId: string;
    name: string;
    keyHash: string;
    keyPrefix: string;
  }): Promise<GatewayKeySummary>;
  /** Lists gateway key metadata (never plaintext/hash) for a workspace. */
  list(workspaceId: string): Promise<GatewayKeySummary[]>;
  /** Marks a gateway key revoked. Returns false if it doesn't exist in this workspace. */
  revoke(workspaceId: string, keyId: string): Promise<boolean>;
}

export interface GatewayKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Dev-grade user identity (Task 17). There is no password/OAuth here — the
 * dashboard's `/v1/auth/dev-login` finds-or-creates a `User` by email. This
 * is intentionally NOT a production identity provider; it exists so the
 * dashboard has something real to authenticate against while keeping the
 * gateway (not the Next.js app) as the single source of truth for
 * workspace/member/role data.
 */
export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
}

export interface UserMembership {
  memberId: string;
  role: Role;
  workspace: { id: string; name: string };
}

export interface UserStore {
  /** Finds a user by email, creating one (with no memberships) if absent. */
  findOrCreateByEmail(email: string): Promise<UserRecord>;
  /** Lists every workspace membership for a user, with workspace info attached. */
  listMemberships(userId: string): Promise<UserMembership[]>;
}

export interface WorkspaceStore {
  get(workspaceId: string): Promise<WorkspaceInfo | null>;
  /** Persists Razorpay billing fields for a workspace (Task 15). */
  updateBilling(
    workspaceId: string,
    fields: Partial<
      Pick<WorkspaceInfo, 'razorpayCustomerId' | 'razorpaySubscriptionId' | 'subscriptionStatus'>
    >,
  ): Promise<void>;
}

/** Reads/writes a workspace's encrypted upstream provider credentials. */
export interface CredentialStore {
  getForProvider(workspaceId: string, provider: Provider): Promise<StoredCredential | null>;
  /** Creates or replaces (rotates) the credential for a given provider. */
  upsert(
    workspaceId: string,
    provider: Provider,
    secret: EncryptedSecret,
    label?: string | null,
  ): Promise<void>;
  /** Lists credential metadata (never ciphertext) for a workspace. */
  list(workspaceId: string): Promise<CredentialSummary[]>;
  /** Deletes a workspace's credential for a provider. Returns true if one existed. */
  remove(workspaceId: string, provider: Provider): Promise<boolean>;
}

export interface RequestLogStore {
  create(input: RequestLogInput): Promise<void>;
  /** Sums cost for a workspace within a time range (for usage metering, Task 15). */
  sumCostSince(workspaceId: string, since: Date): Promise<number>;
  /** Aggregates ROI/"Money Saved" metrics for a workspace within a time range (Task 18). */
  summary(workspaceId: string, range: { since: Date; until: Date }): Promise<AnalyticsSummary>;
}

export interface ModelBreakdownEntry {
  model: string;
  provider: Provider;
  requests: number;
  totalCostUsd: number;
  totalSavedUsd: number;
  avgLatencyMs: number;
}

export interface AnalyticsSummary {
  totalRequests: number;
  successfulRequests: number;
  errorRequests: number;
  blockedRequests: number;
  avgLatencyMs: number;
  /** Average latency of cache-miss (actually-routed) requests, for "improvement vs baseline" framing. */
  avgLatencyMsNonCached: number;
  cacheHitCount: number;
  cacheHitRate: number;
  totalCostUsd: number;
  totalBaselineCostUsd: number;
  totalSavedUsd: number;
  /** Percent saved vs the baseline-if-everything-used-the-premium-model cost. */
  savedPercent: number;
  byModel: ModelBreakdownEntry[];
}

/** Deduplicates billing provider webhook deliveries by event id (Task 15). */
export interface WebhookEventStore {
  /** Returns true if this event id was already processed (and records it if not). */
  markProcessed(eventId: string, type: string): Promise<boolean>;
}

export interface Stores {
  keys: KeyStore;
  workspaces: WorkspaceStore;
  credentials: CredentialStore;
  requestLogs: RequestLogStore;
  memberships: MembershipStore;
  approvals: ApprovalStore;
  webhookEvents: WebhookEventStore;
  spendingCaps: import('../spending/tracker.js').SpendingCapStore;
  users: UserStore;
}
