import { z } from 'zod';
import {
  DomainError, ProviderRequestError, createPaymentSchema, refundPaymentSchema, minorToRubles, rublesToMinor,
  type PaymentLookupContext, type PaymentProvider, type OperationContext, type PaymentMutationContext, type ProviderReference,
  type CreatePayment, type PaymentResult, type RefundPayment, type RefundResult,
} from '@contentos/types';

const externalId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const amountSchema = z.object({ value: z.string().max(32), currency: z.literal('RUB') });
const paymentSchema = z.object({
  id: externalId, status: z.enum(['pending', 'waiting_for_capture', 'succeeded', 'canceled']), paid: z.boolean(),
  amount: amountSchema, recipient: z.object({ account_id: z.string() }), test: z.boolean(),
  metadata: z.object({ order_id: z.uuid() }),
  confirmation: z.object({ type: z.literal('redirect'), confirmation_url: z.url().max(2048) }).optional(),
  payment_method: z.object({ id: z.string().min(1).max(128), saved: z.boolean() }).optional(),
  receipt_registration: z.enum(['pending', 'succeeded', 'canceled']).optional(),
});
const refundSchema = z.object({ id: externalId, payment_id: externalId, amount: amountSchema, status: z.enum(['pending', 'succeeded', 'canceled']), receipt_registration: z.enum(['pending', 'succeeded', 'canceled']).optional() });
const configSchema = z.object({ shopId: z.string().regex(/^\d{1,32}$/), secretKey: z.string().min(1).max(512).regex(/^[^\s:]+$/), test: z.boolean(), returnOrigin: z.url() }).strict();
export type YooKassaConfig = z.infer<typeof configSchema>;
const statuses = { pending: 'PENDING', waiting_for_capture: 'WAITING_CAPTURE', succeeded: 'SUCCEEDED', canceled: 'CANCELED' } as const;
type RequestContext = PaymentLookupContext & Partial<Pick<OperationContext, 'internalId' | 'tenantId' | 'idempotencyKey'>>;
const replayWindowMs = 23 * 60 * 60 * 1000;

/** Single-attempt transport. Retry timing and immutable request storage belong to the durable worker. */
export class YooKassaPaymentProvider implements PaymentProvider {
  readonly name = 'yookassa';
  private readonly config: YooKassaConfig;
  constructor(config: YooKassaConfig, private readonly transport: typeof fetch = fetch) {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) throw new DomainError('CONFIGURATION_REQUIRED', 503);
    const origin = new URL(parsed.data.returnOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new DomainError('CONFIGURATION_REQUIRED', 503);
    this.config = { ...parsed.data, returnOrigin: origin.origin };
  }
  private reference(id: string, context: Pick<OperationContext, 'internalId'>, metadata: Record<string, unknown> = {}): ProviderReference {
    return { provider: this.name, externalId: id, internalId: context.internalId, metadata: { merchantId: this.config.shopId, test: this.config.test, ...metadata } };
  }
  private checkReference(reference: ProviderReference, context?: OperationContext) {
    if (reference.provider !== this.name || !externalId.safeParse(reference.externalId).success || !z.uuid().safeParse(reference.internalId).success || reference.metadata.merchantId !== this.config.shopId || reference.metadata.test !== this.config.test || (context && reference.internalId !== context.internalId)) throw new DomainError('INVALID_INPUT');
  }
  private checkMutation(context: PaymentMutationContext) {
    if (!z.uuid().safeParse(context.idempotencyKey).success || !z.iso.datetime().safeParse(context.firstSubmittedAt).success) throw new DomainError('INVALID_INPUT');
    const age = Date.now() - Date.parse(context.firstSubmittedAt);
    if (age < -5000 || age >= replayWindowMs) throw new ProviderRequestError('RECONCILIATION_REQUIRED', 409, false);
  }
  private receipt(input: CreatePayment | Extract<RefundPayment, { mode: 'PARTIAL' }>) {
    return {
      customer: { email: input.receipt.customerEmail },
      ...(input.receipt.taxSystemCode === undefined ? {} : { tax_system_code: input.receipt.taxSystemCode }),
      items: [{ description: input.description, quantity: '1.000', amount: { value: minorToRubles(input.amountMinor), currency: input.currency }, vat_code: input.receipt.vatCode, payment_mode: input.receipt.mode, payment_subject: input.receipt.subject, measure: 'piece' }],
    };
  }
  private parsePayment(raw: unknown, context: Pick<OperationContext, 'internalId'>, expectedId?: string): PaymentResult {
    const payment = paymentSchema.parse(raw);
    if (payment.recipient.account_id !== this.config.shopId || payment.test !== this.config.test || payment.metadata.order_id !== context.internalId || (expectedId && payment.id !== expectedId)) throw new Error('PAYMENT_IDENTITY_MISMATCH');
    if (payment.status === 'succeeded' && !payment.paid) throw new Error('PAYMENT_STATE_MISMATCH');
    let confirmationUrl: string | null = null;
    if (payment.confirmation) {
      const url = new URL(payment.confirmation.confirmation_url);
      if (url.protocol !== 'https:' || url.username || url.password || (url.hostname !== 'yoomoney.ru' && !url.hostname.endsWith('.yoomoney.ru') && url.hostname !== 'yookassa.ru' && !url.hostname.endsWith('.yookassa.ru'))) throw new Error('INVALID_CONFIRMATION_URL');
      confirmationUrl = url.href;
    }
    return {
      reference: this.reference(payment.id, context),
      observation: { provider: this.name, externalId: payment.id, internalId: context.internalId, merchantId: payment.recipient.account_id, test: payment.test, amountMinor: rublesToMinor(payment.amount.value), currency: payment.amount.currency, status: statuses[payment.status], paid: payment.paid },
      confirmationUrl,
      savedPaymentMethodId: payment.payment_method?.saved && payment.paid && ['succeeded', 'waiting_for_capture'].includes(payment.status) ? payment.payment_method.id : null,
      receiptStatus: payment.receipt_registration ? statuses[payment.receipt_registration] : null,
    };
  }
  private async request<T>(path: string, method: 'GET' | 'POST', context: RequestContext, parse: (raw: unknown) => T, body?: unknown): Promise<T> {
    if (![context.correlationId, ...[context.internalId, context.tenantId].filter(value => value !== undefined)].every(value => z.uuid().safeParse(value).success) || (method === 'POST' && (!context.internalId || !context.tenantId || !context.idempotencyKey))) throw new DomainError('INVALID_INPUT');
    if (context.signal.aborted) throw new ProviderRequestError('PROVIDER_UNAVAILABLE', 503, false);
    const started = Date.now(); let status = 0;
    try {
      const response = await this.transport(`https://api.yookassa.ru/v3/${path}`, {
        method, headers: { Authorization: `Basic ${Buffer.from(`${this.config.shopId}:${this.config.secretKey}`).toString('base64')}`, 'Content-Type': 'application/json', ...(method === 'POST' ? { 'Idempotence-Key': context.idempotencyKey! } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error', signal: AbortSignal.any([context.signal, AbortSignal.timeout(30000)]),
      });
      status = response.status;
      const reader = response.body?.getReader(); if (!reader) throw new Error('MISSING_RESPONSE');
      const chunks: Uint8Array[] = []; let size = 0;
      try { for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 128000) throw new Error('RESPONSE_TOO_LARGE'); chunks.push(next.value); } } finally { await reader.cancel(); }
      const raw: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!response.ok) {
        const error = z.object({ type: z.literal('error'), code: z.string(), id: z.string() }).safeParse(raw);
        if (error.success && [400, 401, 403, 404, 429].includes(status)) throw new ProviderRequestError(status === 401 || status === 403 ? 'CONFIGURATION_REQUIRED' : status === 429 ? 'RATE_LIMITED' : 'PROVIDER_REJECTED', 502, true);
        throw new Error('UNVERIFIED_RESPONSE');
      }
      return parse(raw);
    } catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      throw new ProviderRequestError(method === 'POST' ? 'RECONCILIATION_REQUIRED' : 'PROVIDER_UNAVAILABLE', method === 'POST' ? 409 : 503, false);
    } finally {
      console.log(JSON.stringify({ event: 'provider_request', provider: this.name, operation: `${method} ${path.split('/')[0]}`, requestId: context.correlationId, jobId: context.internalId, durationMs: Date.now() - started, status }));
    }
  }
  async create(rawInput: CreatePayment, context: PaymentMutationContext): Promise<PaymentResult> {
    const parsed = createPaymentSchema.safeParse(rawInput); if (!parsed.success) throw new DomainError('INVALID_INPUT');
    const input = parsed.data; this.checkMutation(context);
    if (input.mode === 'CHECKOUT' && new URL(input.returnUrl).origin !== this.config.returnOrigin) throw new DomainError('INVALID_INPUT');
    return this.request('payments', 'POST', context, raw => {
      const result = this.parsePayment(raw, context);
      if (result.observation.amountMinor !== input.amountMinor || result.observation.currency !== input.currency || (input.mode === 'CHECKOUT' && result.observation.status === 'PENDING' && !result.confirmationUrl)) throw new Error('PAYMENT_RESPONSE_MISMATCH');
      return result;
    }, { amount: { value: minorToRubles(input.amountMinor), currency: input.currency }, capture: true, description: input.description, metadata: { order_id: context.internalId }, receipt: this.receipt(input), ...(input.mode === 'CHECKOUT' ? { confirmation: { type: 'redirect', return_url: input.returnUrl }, save_payment_method: input.saveMethod } : { payment_method_id: input.paymentMethodId }) });
  }
  async inspect(id: string, context: PaymentLookupContext): Promise<PaymentResult> {
    if (!externalId.safeParse(id).success) throw new DomainError('INVALID_INPUT');
    return this.request(`payments/${id}`, 'GET', context, raw => {
      const payment = paymentSchema.parse(raw);
      return this.parsePayment(payment, { internalId: payment.metadata.order_id }, id);
    });
  }
  async get(reference: ProviderReference, context: OperationContext): Promise<PaymentResult> {
    this.checkReference(reference, context);
    return this.request(`payments/${reference.externalId}`, 'GET', context, raw => this.parsePayment(raw, context, reference.externalId));
  }
  private parseRefund(raw: unknown, paymentId: string, context: OperationContext, expectedId?: string): RefundResult {
    const refund = refundSchema.parse(raw);
    if (refund.payment_id !== paymentId || (expectedId && refund.id !== expectedId)) throw new Error('REFUND_IDENTITY_MISMATCH');
    return { reference: this.reference(refund.id, context, { paymentExternalId: paymentId }), paymentExternalId: refund.payment_id, status: statuses[refund.status], amountMinor: rublesToMinor(refund.amount.value), currency: refund.amount.currency, receiptStatus: refund.receipt_registration ? statuses[refund.receipt_registration] : null };
  }
  async refund(reference: ProviderReference, rawInput: RefundPayment, context: PaymentMutationContext): Promise<RefundResult> {
    this.checkReference(reference); this.checkMutation(context);
    const parsed = refundPaymentSchema.safeParse(rawInput); if (!parsed.success) throw new DomainError('INVALID_INPUT');
    const input = parsed.data;
    return this.request('refunds', 'POST', context, raw => {
      const result = this.parseRefund(raw, reference.externalId, context);
      if (result.amountMinor !== input.amountMinor) throw new Error('REFUND_AMOUNT_MISMATCH');
      return result;
    }, { payment_id: reference.externalId, amount: { value: minorToRubles(input.amountMinor), currency: input.currency }, description: input.description, ...(input.mode === 'PARTIAL' ? { receipt: this.receipt(input) } : {}) });
  }
  async getRefund(reference: ProviderReference, context: OperationContext): Promise<RefundResult> {
    this.checkReference(reference, context);
    const paymentId = externalId.safeParse(reference.metadata.paymentExternalId); if (!paymentId.success) throw new DomainError('INVALID_INPUT');
    return this.request(`refunds/${reference.externalId}`, 'GET', context, raw => this.parseRefund(raw, paymentId.data, context, reference.externalId));
  }
}

export function paymentsFromEnvironment(env: {
  PAYMENTS_ENABLED: string; PAYMENT_PROVIDER: string; NODE_ENV: string; APP_URL: string;
  YOOKASSA_SHOP_ID?: string; YOOKASSA_SECRET_KEY?: string; YOOKASSA_TEST_MODE?: string;
}): PaymentProvider | null {
  if (env.PAYMENTS_ENABLED !== 'true' || env.PAYMENT_PROVIDER === 'disabled') return null;
  if (env.PAYMENT_PROVIDER !== 'yookassa' || !env.YOOKASSA_SHOP_ID || !env.YOOKASSA_SECRET_KEY || !['true', 'false'].includes(env.YOOKASSA_TEST_MODE ?? '') || (env.NODE_ENV === 'production' && env.YOOKASSA_TEST_MODE === 'true')) throw new DomainError('CONFIGURATION_REQUIRED', 503);
  let origin: string;
  try { origin = new URL(env.APP_URL).origin; } catch { throw new DomainError('CONFIGURATION_REQUIRED', 503); }
  return new YooKassaPaymentProvider({ shopId: env.YOOKASSA_SHOP_ID, secretKey: env.YOOKASSA_SECRET_KEY, test: env.YOOKASSA_TEST_MODE === 'true', returnOrigin: origin });
}
