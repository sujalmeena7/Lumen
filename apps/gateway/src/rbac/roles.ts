import type { Role } from '../stores/types.js';

/** Role hierarchy: owner > admin > member. Higher rank implies all lower permissions. */
const ROLE_RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

/** True if `role` meets or exceeds the `required` role. */
export function hasRole(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export class ForbiddenError extends Error {
  constructor(message = 'Insufficient permissions for this action.') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class MembershipRequiredError extends Error {
  constructor(message = 'A valid workspace member identity is required for this action.') {
    super(message);
    this.name = 'MembershipRequiredError';
  }
}

/** Throws ForbiddenError if the member's role does not meet the requirement. */
export function requireRole(role: Role, required: Role): void {
  if (!hasRole(role, required)) {
    throw new ForbiddenError(`This action requires the '${required}' role or higher.`);
  }
}
