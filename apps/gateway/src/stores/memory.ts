import { randomUUID } from 'node:crypto';
import type { Provider } from '@router/core';
import type {
  ApprovalStatus,
  ApprovalStore,
  CreatePendingApprovalInput,
  CredentialStore,
  CredentialSummary,
  GatewayKeySummary,
  KeyStore,
  MemberInfo,
  MembershipStore,
  PendingApprovalRecord,
  RequestLogInput,
  RequestLogStore,
  ResolvedKey,
  Role,
  StoredCredential,
  Stores,
  UserMembership,
  UserRecord,
  UserStore,
  WebhookEventStore,
  WorkspaceInfo,
  WorkspaceStore,
} from './types.js';
import { computeAnalyticsSummary } from './analytics.js';
import type { EncryptedSecret } from '../security/vault.js';
import type { SpendingCapRecord, SpendingCapStore } from '../spending/tracker.js';

interface CredentialRecord extends StoredCredential {
  label: string | null;
  createdAt: Date;
  rotatedAt: Date | null;
}

interface RequestLogRecord extends RequestLogInput {
  createdAt: Date;
}

/**
 * In-memory implementation of all stores. Used by the test suite (so tests run
 * without Postgres) and as a lightweight local demo backend.
 */
export class InMemoryStores implements Stores {
  keysByHash = new Map<string, ResolvedKey>();
  keysById = new Map<string, GatewayKeySummary & { workspaceId: string }>();
  workspaces_ = new Map<string, WorkspaceInfo>();
  credentials_ = new Map<string, CredentialRecord>(); // key: `${workspaceId}:${provider}`
  logs: RequestLogRecord[] = [];
  members_ = new Map<string, MemberInfo>(); // key: `${workspaceId}:${memberId}`
  approvals_ = new Map<string, PendingApprovalRecord>(); // key: approvalId
  processedWebhookEvents = new Set<string>();
  spendingCaps_ = new Map<string, SpendingCapRecord>(); // key: `${workspaceId}:${memberId ?? 'workspace'}`
  users_ = new Map<string, UserRecord>(); // key: userId
  usersByEmail_ = new Map<string, string>(); // email -> userId

  keys: KeyStore = {
    findByHash: async (keyHash) => this.keysByHash.get(keyHash) ?? null,
    touchLastUsed: async (keyId) => {
      const existing = this.keysById.get(keyId);
      if (existing) existing.lastUsedAt = new Date();
    },
    create: async (input) => {
      const id = randomUUID();
      const summary: GatewayKeySummary & { workspaceId: string } = {
        id,
        name: input.name,
        keyPrefix: input.keyPrefix,
        createdAt: new Date(),
        lastUsedAt: null,
        revokedAt: null,
        workspaceId: input.workspaceId,
      };
      this.keysById.set(id, summary);
      this.keysByHash.set(input.keyHash, { workspaceId: input.workspaceId, keyId: id });
      const { workspaceId, ...rest } = summary;
      void workspaceId;
      return rest;
    },
    list: async (workspaceId) => {
      const out: GatewayKeySummary[] = [];
      for (const summary of this.keysById.values()) {
        if (summary.workspaceId === workspaceId) {
          const { workspaceId: _wsId, ...rest } = summary;
          void _wsId;
          out.push(rest);
        }
      }
      return out.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    },
    revoke: async (workspaceId, keyId) => {
      const existing = this.keysById.get(keyId);
      if (!existing || existing.workspaceId !== workspaceId) return false;
      existing.revokedAt = new Date();
      for (const [hash, resolved] of this.keysByHash) {
        if (resolved.keyId === keyId) this.keysByHash.delete(hash);
      }
      return true;
    },
  };

  workspaces: WorkspaceStore = {
    get: async (id) => this.workspaces_.get(id) ?? null,
    updateBilling: async (workspaceId, fields) => {
      const existing = this.workspaces_.get(workspaceId);
      if (!existing) return;
      this.workspaces_.set(workspaceId, { ...existing, ...fields });
    },
  };

  credentials: CredentialStore = {
    getForProvider: async (workspaceId, provider) =>
      this.credentials_.get(`${workspaceId}:${provider}`) ?? null,
    upsert: async (workspaceId, provider, secret, label) => {
      const key = `${workspaceId}:${provider}`;
      const existing = this.credentials_.get(key);
      this.credentials_.set(key, {
        provider,
        ...secret,
        label: label ?? existing?.label ?? null,
        createdAt: existing?.createdAt ?? new Date(),
        rotatedAt: existing ? new Date() : null,
      });
    },
    list: async (workspaceId) => {
      const out: CredentialSummary[] = [];
      for (const [key, record] of this.credentials_) {
        if (key.startsWith(`${workspaceId}:`)) {
          out.push({
            provider: record.provider,
            label: record.label,
            createdAt: record.createdAt,
            rotatedAt: record.rotatedAt,
          });
        }
      }
      return out;
    },
    remove: async (workspaceId, provider) => {
      return this.credentials_.delete(`${workspaceId}:${provider}`);
    },
  };

  requestLogs: RequestLogStore = {
    create: async (input) => {
      this.logs.push({ ...input, createdAt: new Date() });
    },
    sumCostSince: async (workspaceId, since) => {
      return this.logs
        .filter((l) => l.workspaceId === workspaceId && l.createdAt >= since)
        .reduce((sum, l) => sum + l.costUsd, 0);
    },
    summary: async (workspaceId, range) => {
      const rows = this.logs.filter(
        (l) => l.workspaceId === workspaceId && l.createdAt >= range.since && l.createdAt <= range.until,
      );
      return computeAnalyticsSummary(rows);
    },
  };

  webhookEvents: WebhookEventStore = {
    markProcessed: async (eventId) => {
      if (this.processedWebhookEvents.has(eventId)) return true;
      this.processedWebhookEvents.add(eventId);
      return false;
    },
  };

  spendingCaps: SpendingCapStore = {
    getWorkspaceCap: async (workspaceId) => this.spendingCaps_.get(`${workspaceId}:workspace`) ?? null,
    getMemberCap: async (workspaceId, memberId) =>
      this.spendingCaps_.get(`${workspaceId}:${memberId}`) ?? null,
    upsert: async (workspaceId, memberId, monthlyLimitUsd) => {
      const key = `${workspaceId}:${memberId ?? 'workspace'}`;
      const existing = this.spendingCaps_.get(key);
      const record: SpendingCapRecord = {
        id: existing?.id ?? randomUUID(),
        workspaceId,
        memberId,
        monthlyLimitUsd,
      };
      this.spendingCaps_.set(key, record);
      return record;
    },
    list: async (workspaceId) => {
      return [...this.spendingCaps_.values()].filter((c) => c.workspaceId === workspaceId);
    },
    remove: async (workspaceId, memberId) => {
      const key = `${workspaceId}:${memberId ?? 'workspace'}`;
      const existing = this.spendingCaps_.get(key);
      if (!existing || existing.workspaceId !== workspaceId) return false;
      return this.spendingCaps_.delete(key);
    },
  };

  memberships: MembershipStore = {
    get: async (workspaceId, memberId) => this.members_.get(`${workspaceId}:${memberId}`) ?? null,
    listForWorkspace: async (workspaceId) => {
      const out: (MemberInfo & { email: string })[] = [];
      for (const [key, member] of this.members_) {
        if (!key.startsWith(`${workspaceId}:`)) continue;
        const user = this.users_.get(member.userId);
        out.push({ ...member, email: user?.email ?? '(unknown)' });
      }
      return out;
    },
  };

  users: UserStore = {
    findOrCreateByEmail: async (email) => {
      const existingId = this.usersByEmail_.get(email);
      if (existingId) return this.users_.get(existingId)!;
      const id = randomUUID();
      const user: UserRecord = { id, email, name: null };
      this.users_.set(id, user);
      this.usersByEmail_.set(email, id);
      return user;
    },
    listMemberships: async (userId) => {
      const out: UserMembership[] = [];
      for (const [key, member] of this.members_) {
        if (member.userId !== userId) continue;
        const workspaceId = key.split(':')[0]!;
        const workspace = this.workspaces_.get(workspaceId);
        if (!workspace) continue;
        out.push({
          memberId: member.memberId,
          role: member.role,
          workspace: { id: workspace.id, name: workspace.name },
        });
      }
      return out;
    },
  };

  approvals: ApprovalStore = {
    create: async (input: CreatePendingApprovalInput) => {
      const record: PendingApprovalRecord = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        actionType: input.actionType,
        requestedById: input.requestedById,
        payload: input.payload,
        status: 'pending',
        reviewedById: null,
        reviewedAt: null,
        createdAt: new Date(),
      };
      this.approvals_.set(record.id, record);
      return record;
    },
    get: async (workspaceId, approvalId) => {
      const record = this.approvals_.get(approvalId);
      return record && record.workspaceId === workspaceId ? record : null;
    },
    list: async (workspaceId, status?: ApprovalStatus) => {
      return [...this.approvals_.values()].filter(
        (r) => r.workspaceId === workspaceId && (!status || r.status === status),
      );
    },
    review: async (workspaceId, approvalId, status, reviewedById) => {
      const record = this.approvals_.get(approvalId);
      if (!record || record.workspaceId !== workspaceId) return null;
      const updated: PendingApprovalRecord = {
        ...record,
        status,
        reviewedById,
        reviewedAt: new Date(),
      };
      this.approvals_.set(approvalId, updated);
      return updated;
    },
  };

  // ---- test/demo helpers ----
  addKey(keyHash: string, resolved: ResolvedKey): void {
    this.keysByHash.set(keyHash, resolved);
  }
  addWorkspace(ws: WorkspaceInfo): void {
    this.workspaces_.set(ws.id, ws);
  }
  addCredential(workspaceId: string, provider: Provider, cred: EncryptedSecret): void {
    this.credentials_.set(`${workspaceId}:${provider}`, {
      provider,
      ...cred,
      label: null,
      createdAt: new Date(),
      rotatedAt: null,
    });
  }
  addMember(workspaceId: string, memberId: string, userId: string, role: Role): void {
    this.members_.set(`${workspaceId}:${memberId}`, { memberId, workspaceId, userId, role });
  }
  addUser(userId: string, email: string, name: string | null = null): void {
    this.users_.set(userId, { id: userId, email, name });
    this.usersByEmail_.set(email, userId);
  }
}
