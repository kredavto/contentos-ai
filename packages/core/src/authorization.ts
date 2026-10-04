import { DomainError, type Action, type Role, type TenantContext } from '@contentos/types';
const permissions: Record<Role, readonly Action[]> = {
  OWNER: ['read', 'brand:write', 'content:write', 'content:approve', 'publish', 'team:manage', 'billing:manage', 'organization:delete'],
  ADMIN: ['read', 'brand:write', 'content:write', 'content:approve', 'publish', 'team:manage'],
  MANAGER: ['read', 'brand:write', 'content:write', 'content:approve', 'publish'],
  EDITOR: ['read', 'content:write'],
  CLIENT_APPROVER: ['read', 'content:approve'],
  VIEWER: ['read'],
};
export function authorize(context: TenantContext, action: Action): void {
  if (!context.userId || !context.tenantId || !permissions[context.role]?.includes(action)) throw new DomainError('NOT_AUTHORIZED', 403);
}
export function assertTenant(context: TenantContext, resourceTenantId: string): void {
  authorize(context, 'read');
  if (context.tenantId !== resourceTenantId) throw new DomainError('NOT_FOUND', 404);
}
