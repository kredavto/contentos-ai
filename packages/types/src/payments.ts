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
