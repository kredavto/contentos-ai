import { z } from 'zod';

/** First merchant integration supports RUB only; never infer an FX conversion. */
export const paymentMoneySchema = z.object({
  amountMinor: z.number().int().safe().positive().max(1_000_000_000),
  currency: z.literal('RUB'),
}).strict();
export const paymentIdentitySchema = z.object({
  provider: z.string().min(1).max(64),
  externalId: z.string().min(1).max(128),
  internalId: z.uuid(),
  merchantId: z.string().min(1).max(128),
  test: z.boolean(),
}).strict();
export const paymentObservationSchema = paymentIdentitySchema.extend({
  ...paymentMoneySchema.shape,
  status: z.enum(['PENDING', 'WAITING_CAPTURE', 'SUCCEEDED', 'CANCELED']),
  paid: z.boolean(),
}).strict();
export type PaymentObservation = z.infer<typeof paymentObservationSchema>;
export const expectedPaymentSchema = paymentIdentitySchema.extend(paymentMoneySchema.shape).strict();
export type ExpectedPayment = z.infer<typeof expectedPaymentSchema>;

/** Must receive an authenticated provider observation, never a webhook body. */
export function paymentSettlementEligible(expected: ExpectedPayment, observed: unknown): boolean {
  const order = expectedPaymentSchema.parse(expected);
  const result = paymentObservationSchema.safeParse(observed);
  if (!result.success) return false;
  const payment = result.data;
  return payment.status === 'SUCCEEDED' && payment.paid &&
    payment.provider === order.provider && payment.externalId === order.externalId &&
    payment.internalId === order.internalId && payment.merchantId === order.merchantId &&
    payment.test === order.test && payment.amountMinor === order.amountMinor && payment.currency === order.currency;
}

/** Decimal boundary conversion without floating point multiplication/rounding. */
export function rublesToMinor(value: string): number {
  if (!/^(0|[1-9]\d{0,8})\.\d{2}$/.test(value)) throw new Error('INVALID_PAYMENT_AMOUNT');
  const [whole, fraction] = value.split('.');
  const amount = BigInt(whole!) * 100n + BigInt(fraction!);
  if (amount < 1n || amount > 1_000_000_000n) throw new Error('INVALID_PAYMENT_AMOUNT');
  return Number(amount);
}
export function minorToRubles(amountMinor: number): string {
  paymentMoneySchema.parse({ amountMinor, currency: 'RUB' });
  const amount = BigInt(amountMinor);
  return `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
}

/** Use the original anchor each time so short months do not shift later renewals. */
export function monthlyBillingBoundary(anchor: Date, monthOffset: number): Date {
  if (!Number.isFinite(anchor.getTime()) || !Number.isSafeInteger(monthOffset) || monthOffset < 0 || monthOffset > 1200) throw new Error('INVALID_BILLING_PERIOD');
  const result = new Date(anchor);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + monthOffset);
  const lastDay = new Date(result);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  result.setUTCDate(Math.min(anchor.getUTCDate(), lastDay.getUTCDate()));
  if (!Number.isFinite(result.getTime())) throw new Error('INVALID_BILLING_PERIOD');
  return result;
}

/** Receipt classification is supplied from reviewed merchant configuration, never inferred. */
export const paymentReceiptSchema = z.object({
  customerEmail: z.email().max(254),
  vatCode: z.number().int().min(1).max(12),
  taxSystemCode: z.number().int().min(1).max(6).optional(),
  subject: z.enum(['service', 'intellectual_activity']),
  mode: z.literal('full_payment'),
}).strict();
const safeHttps = z.url().max(2048).refine(value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
});
const paymentFields = {
  ...paymentMoneySchema.shape,
  description: z.string().trim().min(1).max(128),
  receipt: paymentReceiptSchema,
};
export const createPaymentSchema = z.discriminatedUnion('mode', [
  z.object({ ...paymentFields, mode: z.literal('CHECKOUT'), returnUrl: safeHttps, saveMethod: z.boolean() }).strict(),
  z.object({ ...paymentFields, mode: z.literal('RENEWAL'), paymentMethodId: z.string().min(1).max(128) }).strict(),
]);
export type CreatePayment = z.infer<typeof createPaymentSchema>;
export type PaymentResult = {
  reference: import('./providers').ProviderReference;
  observation: PaymentObservation;
  confirmationUrl: string | null;
  savedPaymentMethodId: string | null;
  receiptStatus: 'PENDING' | 'SUCCEEDED' | 'CANCELED' | null;
};
export type PaymentMutationContext = import('./providers').OperationContext & { firstSubmittedAt: string };
export const refundPaymentSchema = z.discriminatedUnion('mode', [
  z.object({ ...paymentMoneySchema.shape, description: paymentFields.description, mode: z.literal('FULL') }).strict(),
  z.object({ ...paymentFields, mode: z.literal('PARTIAL') }).strict(),
]);
export type RefundPayment = z.infer<typeof refundPaymentSchema>;
export type RefundResult = {
  reference: import('./providers').ProviderReference;
  paymentExternalId: string;
  status: 'PENDING' | 'SUCCEEDED' | 'CANCELED';
  amountMinor: number;
  currency: 'RUB';
  receiptStatus: 'PENDING' | 'SUCCEEDED' | 'CANCELED' | null;
};

export const renewalAcceptanceSchema = z.object({
  planVersionId: z.uuid(), policyVersion: z.string().min(1).max(40), textHash: z.string().regex(/^[a-f0-9]{64}$/), accepted: z.literal(true),
  expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.uuid(),
}).strict();
export const renewalCancellationSchema = z.object({ expectedRevision: z.number().int().nonnegative(), idempotencyKey: z.uuid() }).strict();
export type RenewalAcceptance = z.infer<typeof renewalAcceptanceSchema>;
export type RenewalCancellation = z.infer<typeof renewalCancellationSchema>;

/** Retain routing hints only. Status, metadata, card data and amounts from the body are untrusted. */
export const paymentNotificationSchema = z.object({
  type: z.literal('notification'),
  event: z.enum(['payment.succeeded', 'payment.canceled', 'payment.waiting_for_capture']),
  object: z.object({ id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).transform(value => value.toLowerCase()) }),
});
export type PaymentNotification = z.infer<typeof paymentNotificationSchema>;

export const billingCheckoutSchema = z.object({ planVersionId: z.uuid(), idempotencyKey: z.uuid(), renewal: z.object({ consentId: z.uuid(), revision: z.number().int().positive() }).strict().optional() }).strict();

/** Durable renewal intent omits the decrypted provider method reference. */
export type StoredPaymentRequest = Extract<CreatePayment, {mode:'CHECKOUT'}> | Omit<Extract<CreatePayment, {mode:'RENEWAL'}>, 'paymentMethodId'>;
