import { describe, expect, it } from 'vitest';
import { authorize, assertTenant } from '../packages/core/src/authorization';
import { assertContentTransition } from '../packages/core/src/content-state';
import { roles, type TenantContext } from '../packages/types/src/index';
const context: TenantContext = { userId: 'user-a', tenantId: 'tenant-a', role: 'OWNER' };
describe('authorization policy', () => {
  it.each(roles)('prevents cross-tenant access for %s', role => {
    expect(() => assertTenant({ ...context, role }, 'tenant-b')).toThrow('NOT_FOUND');
  });
  it('prevents editor approval and client publishing', () => {
    expect(() => authorize({ ...context, role: 'EDITOR' }, 'content:approve')).toThrow('NOT_AUTHORIZED');
    expect(() => authorize({ ...context, role: 'CLIENT_APPROVER' }, 'publish')).toThrow('NOT_AUTHORIZED');
    expect(() => authorize({ ...context, role: 'VIEWER' }, 'brand:write')).toThrow('NOT_AUTHORIZED');
  });
  it('limits organization deletion to owner', () => {
    expect(() => authorize({ ...context, role: 'ADMIN' }, 'organization:delete')).toThrow('NOT_AUTHORIZED');
    expect(() => authorize(context, 'organization:delete')).not.toThrow();
  });
  it('requires approval before scheduling and prevents republishing', () => {
    expect(() => assertContentTransition('READY', 'SCHEDULED')).toThrow('CONFLICT');
    expect(() => assertContentTransition('PUBLISHED', 'PUBLISHING')).toThrow('CONFLICT');
    expect(() => assertContentTransition('APPROVED', 'SCHEDULED')).not.toThrow();
  });
});
