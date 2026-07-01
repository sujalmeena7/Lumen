import { describe, it, expect } from 'vitest';
import { hasRole, requireRole, ForbiddenError } from './roles.js';

describe('hasRole', () => {
  it('owner meets every requirement', () => {
    expect(hasRole('owner', 'owner')).toBe(true);
    expect(hasRole('owner', 'admin')).toBe(true);
    expect(hasRole('owner', 'member')).toBe(true);
  });
  it('admin meets admin/member but not owner', () => {
    expect(hasRole('admin', 'admin')).toBe(true);
    expect(hasRole('admin', 'member')).toBe(true);
    expect(hasRole('admin', 'owner')).toBe(false);
  });
  it('member only meets member', () => {
    expect(hasRole('member', 'member')).toBe(true);
    expect(hasRole('member', 'admin')).toBe(false);
    expect(hasRole('member', 'owner')).toBe(false);
  });
});

describe('requireRole', () => {
  it('does not throw when the role is sufficient', () => {
    expect(() => requireRole('owner', 'admin')).not.toThrow();
  });
  it('throws ForbiddenError when insufficient', () => {
    expect(() => requireRole('member', 'admin')).toThrow(ForbiddenError);
  });
});
