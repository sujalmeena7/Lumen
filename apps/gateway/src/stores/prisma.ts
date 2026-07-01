import type { PrismaClient, Provider as DbProvider } from '@router/db';
import type { Provider } from '@router/core';
import type {
  ApprovalStatus,
  ApprovalStore,
  CreatePendingApprovalInput,
  CredentialStore,
  GatewayKeySummary,
  KeyStore,
  MembershipStore,
  RequestLogStore,
  Role,
  Stores,
  UserMembership,
  UserRecord,
  UserStore,
  WebhookEventStore,
  WorkspaceStore,
} from './types.js';
import { computeAnalyticsSummary } from './analytics.js';
import type { SpendingCapStore } from '../spending/tracker.js';

/** Production stores backed by Postgres via Prisma. */
export function createPrismaStores(prisma: PrismaClient): Stores {
  const keys: KeyStore = {
    findByHash: async (keyHash) => {
      const row = await prisma.gatewayApiKey.findUnique({ where: { keyHash } });
      if (!row || row.revokedAt) return null;
      return { workspaceId: row.workspaceId, keyId: row.id };
    },
    touchLastUsed: async (keyId) => {
      await prisma.gatewayApiKey.update({
        where: { id: keyId },
        data: { lastUsedAt: new Date() },
      });
    },
    create: async (input) => {
      const row = await prisma.gatewayApiKey.create({
        data: {
          workspaceId: input.workspaceId,
          name: input.name,
          keyHash: input.keyHash,
          keyPrefix: input.keyPrefix,
        },
      });
      return {
        id: row.id,
        name: row.name,
        keyPrefix: row.keyPrefix,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
      };
    },
    list: async (workspaceId) => {
      const rows = await prisma.gatewayApiKey.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((row) => ({
        id: row.id,
        name: row.name,
        keyPrefix: row.keyPrefix,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        revokedAt: row.revokedAt,
      }));
    },
    revoke: async (workspaceId, keyId) => {
      const row = await prisma.gatewayApiKey.findUnique({ where: { id: keyId } });
      if (!row || row.workspaceId !== workspaceId) return false;
      await prisma.gatewayApiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
      return true;
    },
  };

  const workspaces: WorkspaceStore = {
    get: async (id) => {
      const ws = await prisma.workspace.findUnique({ where: { id } });
      if (!ws) return null;
      return {
        id: ws.id,
        name: ws.name,
        routingWeights: (ws.routingWeights as WorkspaceInfoWeights) ?? null,
        requireApprovalForSensitiveActions: ws.requireApprovalForSensitiveActions,
        razorpayCustomerId: ws.razorpayCustomerId,
        razorpaySubscriptionId: ws.razorpaySubscriptionId,
        subscriptionStatus: ws.subscriptionStatus,
      };
    },
    updateBilling: async (workspaceId, fields) => {
      await prisma.workspace.update({
        where: { id: workspaceId },
        data: {
          razorpayCustomerId: fields.razorpayCustomerId ?? undefined,
          razorpaySubscriptionId: fields.razorpaySubscriptionId ?? undefined,
          subscriptionStatus: fields.subscriptionStatus ?? undefined,
        },
      });
    },
  };

  const credentials: CredentialStore = {
    getForProvider: async (workspaceId, provider) => {
      const row = await prisma.providerCredential.findUnique({
        where: { workspaceId_provider: { workspaceId, provider: provider as DbProvider } },
      });
      if (!row) return null;
      return {
        provider: row.provider as Provider,
        ciphertext: row.ciphertext,
        iv: row.iv,
        authTag: row.authTag,
        encryptedDek: row.encryptedDek,
      };
    },
    upsert: async (workspaceId, provider, secret, label) => {
      const dbProvider = provider as DbProvider;
      const existing = await prisma.providerCredential.findUnique({
        where: { workspaceId_provider: { workspaceId, provider: dbProvider } },
      });
      await prisma.providerCredential.upsert({
        where: { workspaceId_provider: { workspaceId, provider: dbProvider } },
        create: {
          workspaceId,
          provider: dbProvider,
          label: label ?? null,
          ciphertext: secret.ciphertext,
          iv: secret.iv,
          authTag: secret.authTag,
          encryptedDek: secret.encryptedDek,
        },
        update: {
          label: label ?? undefined,
          ciphertext: secret.ciphertext,
          iv: secret.iv,
          authTag: secret.authTag,
          encryptedDek: secret.encryptedDek,
          rotatedAt: existing ? new Date() : undefined,
        },
      });
    },
    list: async (workspaceId) => {
      const rows = await prisma.providerCredential.findMany({ where: { workspaceId } });
      return rows.map((row) => ({
        provider: row.provider as Provider,
        label: row.label,
        createdAt: row.createdAt,
        rotatedAt: row.rotatedAt,
      }));
    },
    remove: async (workspaceId, provider) => {
      try {
        await prisma.providerCredential.delete({
          where: { workspaceId_provider: { workspaceId, provider: provider as DbProvider } },
        });
        return true;
      } catch {
        return false;
      }
    },
  };

  const requestLogs: RequestLogStore = {
    create: async (input) => {
      await prisma.requestLog.create({
        data: {
          workspaceId: input.workspaceId,
          traceId: input.traceId,
          requestedModel: input.requestedModel,
          chosenModel: input.chosenModel,
          provider: input.provider as DbProvider,
          promptTokens: input.promptTokens,
          completionTokens: input.completionTokens,
          totalTokens: input.totalTokens,
          costUsd: input.costUsd,
          baselineCostUsd: input.baselineCostUsd,
          savedUsd: input.savedUsd,
          latencyMs: input.latencyMs,
          cacheHit: input.cacheHit,
          fallbackUsed: input.fallbackUsed,
          complexityScore: input.complexityScore ?? null,
          status: input.status,
          errorMessage: input.errorMessage ?? null,
        },
      });
    },
    sumCostSince: async (workspaceId, since) => {
      const result = await prisma.requestLog.aggregate({
        where: { workspaceId, createdAt: { gte: since } },
        _sum: { costUsd: true },
      });
      return result._sum.costUsd ?? 0;
    },
    summary: async (workspaceId, range) => {
      const rows = await prisma.requestLog.findMany({
        where: { workspaceId, createdAt: { gte: range.since, lte: range.until } },
        select: {
          chosenModel: true,
          provider: true,
          costUsd: true,
          baselineCostUsd: true,
          savedUsd: true,
          latencyMs: true,
          cacheHit: true,
          status: true,
        },
      });
      return computeAnalyticsSummary(
        rows.map((r) => ({
          chosenModel: r.chosenModel,
          provider: r.provider as Provider,
          costUsd: r.costUsd,
          baselineCostUsd: r.baselineCostUsd,
          savedUsd: r.savedUsd,
          latencyMs: r.latencyMs,
          cacheHit: r.cacheHit,
          status: r.status as 'success' | 'error' | 'blocked',
        })),
      );
    },
  };

  const webhookEvents: WebhookEventStore = {
    markProcessed: async (eventId, type) => {
      try {
        await prisma.webhookEvent.create({ data: { id: eventId, type } });
        return false; // first time seeing this event
      } catch {
        return true; // already processed (unique constraint violation)
      }
    },
  };

  const memberships: MembershipStore = {
    get: async (workspaceId, memberId) => {
      const row = await prisma.workspaceMember.findUnique({ where: { id: memberId } });
      if (!row || row.workspaceId !== workspaceId) return null;
      return {
        memberId: row.id,
        workspaceId: row.workspaceId,
        userId: row.userId,
        role: row.role as Role,
      };
    },
    listForWorkspace: async (workspaceId) => {
      const rows = await prisma.workspaceMember.findMany({
        where: { workspaceId },
        include: { user: true },
      });
      return rows.map((row) => ({
        memberId: row.id,
        workspaceId: row.workspaceId,
        userId: row.userId,
        role: row.role as Role,
        email: row.user.email,
      }));
    },
  };

  const users: UserStore = {
    findOrCreateByEmail: async (email) => {
      const row = await prisma.user.upsert({
        where: { email },
        update: {},
        create: { email },
      });
      return { id: row.id, email: row.email, name: row.name };
    },
    listMemberships: async (userId) => {
      const rows = await prisma.workspaceMember.findMany({
        where: { userId },
        include: { workspace: true },
      });
      return rows.map((row): UserMembership => ({
        memberId: row.id,
        role: row.role as Role,
        workspace: { id: row.workspace.id, name: row.workspace.name },
      }));
    },
  };

  const approvals: ApprovalStore = {
    create: async (input) => {
      const row = await prisma.pendingApproval.create({
        data: {
          workspaceId: input.workspaceId,
          actionType: input.actionType,
          requestedById: input.requestedById,
          payload: input.payload as object,
        },
      });
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        actionType: row.actionType as CreatePendingApprovalInput['actionType'],
        requestedById: row.requestedById,
        payload: row.payload,
        status: row.status as ApprovalStatus,
        reviewedById: row.reviewedById,
        reviewedAt: row.reviewedAt,
        createdAt: row.createdAt,
      };
    },
    get: async (workspaceId, approvalId) => {
      const row = await prisma.pendingApproval.findUnique({ where: { id: approvalId } });
      if (!row || row.workspaceId !== workspaceId) return null;
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        actionType: row.actionType as CreatePendingApprovalInput['actionType'],
        requestedById: row.requestedById,
        payload: row.payload,
        status: row.status as ApprovalStatus,
        reviewedById: row.reviewedById,
        reviewedAt: row.reviewedAt,
        createdAt: row.createdAt,
      };
    },
    list: async (workspaceId, status) => {
      const rows = await prisma.pendingApproval.findMany({
        where: { workspaceId, ...(status ? { status } : {}) },
      });
      return rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        actionType: row.actionType as CreatePendingApprovalInput['actionType'],
        requestedById: row.requestedById,
        payload: row.payload,
        status: row.status as ApprovalStatus,
        reviewedById: row.reviewedById,
        reviewedAt: row.reviewedAt,
        createdAt: row.createdAt,
      }));
    },
    review: async (workspaceId, approvalId, status, reviewedById) => {
      const existing = await prisma.pendingApproval.findUnique({ where: { id: approvalId } });
      if (!existing || existing.workspaceId !== workspaceId) return null;
      const row = await prisma.pendingApproval.update({
        where: { id: approvalId },
        data: { status, reviewedById, reviewedAt: new Date() },
      });
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        actionType: row.actionType as CreatePendingApprovalInput['actionType'],
        requestedById: row.requestedById,
        payload: row.payload,
        status: row.status as ApprovalStatus,
        reviewedById: row.reviewedById,
        reviewedAt: row.reviewedAt,
        createdAt: row.createdAt,
      };
    },
  };

  const spendingCaps: SpendingCapStore = {
    getWorkspaceCap: async (workspaceId) => {
      // Prisma's `findUnique` cannot take `null` for a nullable field that's
      // part of a compound unique index (long-standing limitation:
      // https://github.com/prisma/prisma/issues/3197) — use `findFirst`
      // instead for the workspace-wide cap (memberId IS NULL).
      const row = await prisma.spendingCap.findFirst({
        where: { workspaceId, memberId: null },
      });
      return row
        ? { id: row.id, workspaceId: row.workspaceId, memberId: row.memberId, monthlyLimitUsd: row.monthlyLimitUsd }
        : null;
    },
    getMemberCap: async (workspaceId, memberId) => {
      const row = await prisma.spendingCap.findUnique({
        where: { workspaceId_memberId: { workspaceId, memberId } },
      });
      return row
        ? { id: row.id, workspaceId: row.workspaceId, memberId: row.memberId, monthlyLimitUsd: row.monthlyLimitUsd }
        : null;
    },
    upsert: async (workspaceId, memberId, monthlyLimitUsd) => {
      // Same `findUnique`-with-null limitation applies to upsert's `where`;
      // emulate upsert manually when memberId is null (workspace-wide cap).
      if (memberId === null || memberId === undefined) {
        const existing = await prisma.spendingCap.findFirst({ where: { workspaceId, memberId: null } });
        const row = existing
          ? await prisma.spendingCap.update({ where: { id: existing.id }, data: { monthlyLimitUsd } })
          : await prisma.spendingCap.create({ data: { workspaceId, memberId: null, monthlyLimitUsd } });
        return { id: row.id, workspaceId: row.workspaceId, memberId: row.memberId, monthlyLimitUsd: row.monthlyLimitUsd };
      }
      const row = await prisma.spendingCap.upsert({
        where: { workspaceId_memberId: { workspaceId, memberId } },
        create: { workspaceId, memberId, monthlyLimitUsd },
        update: { monthlyLimitUsd },
      });
      return { id: row.id, workspaceId: row.workspaceId, memberId: row.memberId, monthlyLimitUsd: row.monthlyLimitUsd };
    },
    list: async (workspaceId) => {
      const rows = await prisma.spendingCap.findMany({ where: { workspaceId } });
      return rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        memberId: row.memberId,
        monthlyLimitUsd: row.monthlyLimitUsd,
      }));
    },
    remove: async (workspaceId, memberId) => {
      if (memberId === null || memberId === undefined) {
        const existing = await prisma.spendingCap.findFirst({ where: { workspaceId, memberId: null } });
        if (!existing) return false;
        await prisma.spendingCap.delete({ where: { id: existing.id } });
        return true;
      }
      try {
        await prisma.spendingCap.delete({
          where: { workspaceId_memberId: { workspaceId, memberId } },
        });
        return true;
      } catch {
        return false;
      }
    },
  };

  return {
    keys,
    workspaces,
    credentials,
    requestLogs,
    memberships,
    approvals,
    webhookEvents,
    spendingCaps,
    users,
  };
}

type WorkspaceInfoWeights = { cost: number; latency: number; quality: number } | null;
