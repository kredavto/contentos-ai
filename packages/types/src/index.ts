export const roles = ['OWNER', 'ADMIN', 'MANAGER', 'EDITOR', 'CLIENT_APPROVER', 'VIEWER'] as const;
export type Role = (typeof roles)[number];
export type Action = 'read' | 'brand:write' | 'content:write' | 'content:approve' | 'publish' | 'team:manage' | 'billing:manage' | 'organization:delete';
export type TenantContext = Readonly<{ userId: string; tenantId: string; role: Role }>;
export type ProviderStatus = 'READY' | 'CONFIGURATION_REQUIRED' | 'DISABLED' | 'ERROR';
export const contentStates = ['IDEA', 'SCRIPT', 'APPROVED_SCRIPT', 'GENERATING', 'READY', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED'] as const;
export type ContentState = (typeof contentStates)[number];
export type ErrorCode = 'NOT_AUTHORIZED' | 'NOT_FOUND' | 'INVALID_INPUT' | 'CONFLICT' | 'PLAN_LIMIT_REACHED' | 'INSUFFICIENT_CREDITS' | 'INSUFFICIENT_VIDEO_SECONDS' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_REJECTED' | 'SOCIAL_TOKEN_EXPIRED' | 'PUBLISHING_FAILED' | 'INVALID_MEDIA' | 'CONSENT_REQUIRED' | 'CONFIGURATION_REQUIRED' | 'RATE_LIMITED' | 'RECONCILIATION_REQUIRED';
const domainErrorBrand = Symbol.for('contentos.domain-error.v1');
export class DomainError extends Error {
  readonly [domainErrorBrand] = true;
  static [Symbol.hasInstance](value: unknown): boolean {
    if (this !== DomainError) return Function.prototype[Symbol.hasInstance].call(this, value) as boolean;
    return typeof value === 'object' && value !== null && domainErrorBrand in value && value[domainErrorBrand] === true;
  }
  constructor(public readonly code: ErrorCode, public readonly status = 400) { super(code); this.name = 'DomainError'; }
}
export * from './providers';
export * from './onboarding';
export * from './generation';
export * from './consent';
export * from './media';

export * from './avatars';
export class ProviderRequestError extends DomainError {
  constructor(code: ErrorCode, status: number, public readonly definitiveRejection: boolean) { super(code,status); }
}
export * from './video-processing';
export * from './videos';
export * from './calendar';
export * from './social';
export * from './publishing';
export * from './analytics';

export * from './performance';
export * from './payments';
export * from './notifications';
