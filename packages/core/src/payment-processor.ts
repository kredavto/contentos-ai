import { BillingRepository, PaymentTaskRepository } from '@contentos/db';
import { DomainError, ProviderRequestError, type PaymentProvider, type PaymentResult } from '@contentos/types';
import { CredentialVault } from './credential-vault';
import { PaymentMethodService } from './payment-methods';
/** Checkout transport runs only here, behind the provider interface and durable send marker. */
export class PaymentProcessor {
  private readonly methods: PaymentMethodService;
  constructor(private readonly tasks: PaymentTaskRepository, private readonly billing: BillingRepository, private readonly provider: PaymentProvider | null, private readonly merchant: { provider: string; merchantId: string; test: boolean } | null, private readonly vault: CredentialVault | null) {
    this.methods = new PaymentMethodService(billing, vault);
  }
  async run(tenantId: string, id: string) {
    // Disabled configuration leaves the durable outbox untouched for later configuration.
    if (!this.provider || !this.merchant) return;
    const task = await this.tasks.claim(tenantId, id);
    if (!task?.leaseToken) return;
    const token = task.leaseToken;
    try {
      const operation = await this.tasks.prepare(tenantId, id, token, this.merchant, Boolean(this.vault));
      if (!operation) return;
      const context = { tenantId, internalId: id, idempotencyKey: id, correlationId: operation.order.correlationId, signal: AbortSignal.timeout(45_000) };
      let result: PaymentResult;
      try {
        result = operation.mode === 'READ'
          ? await this.provider.get({ provider: operation.order.provider, externalId: operation.externalId, internalId: id, metadata: { merchantId: operation.order.merchantId, test: operation.order.test } }, context)
          : await this.provider.create(operation.order.input, { ...context, idempotencyKey: operation.idempotencyKey, firstSubmittedAt: operation.firstSubmittedAt.toISOString() });
      } catch (error) {
        await this.tasks.fail(tenantId, id, token, operation.mode === 'CREATE' && error instanceof ProviderRequestError && error.definitiveRejection);
        return;
      }
      await this.tasks.observe(tenantId, id, token, result.observation, result.confirmationUrl);
      if (result.observation.status === 'SUCCEEDED' && result.observation.paid) {
        await this.billing.settle(tenantId, id, result.observation);
        await this.methods.capture(tenantId, id, result);
      }
      await this.tasks.finish(tenantId, id, token);
    } catch (error) {
      // Stale workers cannot mutate the new lease. Any post-send failure remains recoverable by GET/replay.
      try { await this.tasks.fail(tenantId, id, token, false); }
      catch (failure) { if (!(failure instanceof DomainError && failure.code === 'CONFLICT')) throw failure; }
      console.log(JSON.stringify({ event: 'payment_task_error', jobId: id, code: error instanceof DomainError ? error.code : 'PROVIDER_UNAVAILABLE' }));
    }
  }
}
