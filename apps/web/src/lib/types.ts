export interface SessionData {
  userId: string;
  email: string;
  activeWorkspaceId?: string;
  /** The WorkspaceMember id for `activeWorkspaceId`, used for gateway RBAC (X-Member-Id). */
  activeMemberId?: string;
  activeRole?: 'owner' | 'admin' | 'member';
}

export interface WorkspaceMembership {
  memberId: string;
  role: 'owner' | 'admin' | 'member';
  workspace: { id: string; name: string };
}
