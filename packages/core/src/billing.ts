import { z } from 'zod';
import { BillingRepository, RenewalRepository } from '@contentos/db';
import { DomainError, billingCheckoutSchema, renewalAcceptanceSchema, type CreatePayment } from '@contentos/types';
type Receipt = Omit<CreatePayment['receipt'], 'customerEmail'>;
export type CheckoutConfiguration = { merchant: { provider: 'yookassa'; merchantId: string; test: boolean }; receipt: Receipt; appUrl: string };
export class BillingService {
  constructor(private readonly repository: BillingRepository, private readonly renewal: RenewalRepository, private readonly configuration: CheckoutConfiguration | null, private readonly renewalEngineEnabled = false) {}
  async overview(userId: string, tenantId: string) {
    z.uuid().parse(tenantId);
    const subscription = await this.repository.overview(userId, tenantId);
    const plans = await this.repository.catalog(userId, tenantId);
    const renewal = await this.renewal.overview(userId, tenantId, this.configuration?.merchant);
    return { subscription, plans, renewal, renewalEngineReady: Boolean(this.configuration && this.renewalEngineEnabled), checkoutStatus: this.configuration ? 'READY' as const : 'CONFIGURATION_REQUIRED' as const };
  }
  async checkout(userId: string, tenantId: string, raw: unknown, correlationId: string) {
    z.uuid().parse(tenantId);
    const input = billingCheckoutSchema.parse(raw);
    const email = await this.repository.receiptEmail(userId, tenantId);
    if (!this.configuration || (input.renewal && !this.renewalEngineEnabled)) throw new DomainError('CONFIGURATION_REQUIRED', 503);
    const returnUrl = new URL('/billing', this.configuration.appUrl);
    returnUrl.searchParams.set('organization', tenantId);
    const order = await this.repository.checkout(userId, tenantId, input.planVersionId, input.idempotencyKey, { ...(input.renewal ? { renewal: input.renewal } : {}), returnUrl: returnUrl.href, receipt: { ...this.configuration.receipt, customerEmail: email } }, this.configuration.merchant, correlationId);
    return this.repository.orderStatus(userId, tenantId, order.id);
  }
  async renewalPolicy(userId: string, tenantId: string, planVersionId: string) {
    const policy = await this.renewal.preview(userId, z.uuid().parse(tenantId), z.uuid().parse(planVersionId));
    if (!this.configuration || !this.renewalEngineEnabled) throw new DomainError('CONFIGURATION_REQUIRED', 503);
    return policy;
  }
  async acceptRenewal(userId: string, tenantId: string, raw: unknown, request: { ip: string; userAgent: string }, correlationId: string) {
    z.uuid().parse(tenantId);
    const input = renewalAcceptanceSchema.parse(raw);
    await this.repository.receiptEmail(userId, tenantId);
    if (!this.configuration || !this.renewalEngineEnabled) throw new DomainError('CONFIGURATION_REQUIRED', 503);
    const change = await this.renewal.accept(userId, tenantId, input, request, correlationId);
    return { consentId: change.consentId, revision: change.revision };
  }
  orderStatus(userId: string, tenantId: string, orderId: string) {
    return this.repository.orderStatus(userId, z.uuid().parse(tenantId), z.uuid().parse(orderId));
  }
  cancelRenewal(userId: string, tenantId: string, raw: unknown, correlationId: string) {
    const schema = z.object({ expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.uuid() }).strict();
    return this.renewal.cancel(userId, z.uuid().parse(tenantId), schema.parse(raw), correlationId);
  }
}
