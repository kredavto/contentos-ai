import { z } from 'zod';
import { BillingRepository } from '@contentos/db';
import { DomainError, paymentObservationSchema, type PaymentResult } from '@contentos/types';
import { CredentialVault, type PaymentMethodScope } from './credential-vault';
/** Worker service only: called after authenticated status verification and atomic settlement. */
export class PaymentMethodService {
  constructor(private readonly repository: BillingRepository, private readonly vault: CredentialVault | null) {}
  async capture(tenantId: string, orderId: string, result: PaymentResult) {
    z.uuid().parse(tenantId); z.uuid().parse(orderId);
    if (result.savedPaymentMethodId === null) return { saved: false };
    const observed = paymentObservationSchema.parse(result.observation);
    if (!observed.paid || observed.status !== 'SUCCEEDED' || observed.internalId !== orderId) throw new DomainError('CONFLICT', 409);
    if (!this.vault) throw new DomainError('CONFIGURATION_REQUIRED', 503);
    const method = z.string().min(1).max(128).parse(result.savedPaymentMethodId);
    const scope: PaymentMethodScope = { kind: 'PAYMENT_METHOD', tenantId, methodId: orderId, provider: observed.provider, merchantId: observed.merchantId, test: observed.test };
    return this.repository.attachSavedMethod(tenantId, orderId, observed, this.vault.encrypt(method, scope));
  }
}
