import { describe, expect, it } from 'vitest';
import { minorToRubles, monthlyBillingBoundary, paymentSettlementEligible, rublesToMinor, type ExpectedPayment } from '../packages/types/src/payments';
const order: ExpectedPayment = { provider: 'yookassa', externalId: 'external-payment', internalId: 'bb37f3e8-d18a-45ce-8406-aa8fca0144a4', merchantId: 'merchant', test: false, amountMinor: 199900, currency: 'RUB' };
const succeeded = { ...order, status: 'SUCCEEDED', paid: true };
describe('payment settlement boundaries', () => {
  it('requires a matching paid terminal observation', () => {
    expect(paymentSettlementEligible(order, succeeded)).toBe(true);
    for (const status of ['PENDING', 'WAITING_CAPTURE', 'CANCELED', 'unknown']) expect(paymentSettlementEligible(order, { ...succeeded, status })).toBe(false);
    expect(paymentSettlementEligible(order, { ...succeeded, paid: false })).toBe(false);
    expect(paymentSettlementEligible(order, { ...succeeded, paid: undefined })).toBe(false);
  });
  it('rejects substitution of payment, order, merchant, mode, provider or money', () => {
    for (const patch of [{ externalId: 'another' }, { internalId: '23fd9942-aaad-4f11-a307-5df6e9d46e9f' }, { merchantId: 'another' }, { test: true }, { provider: 'mock' }, { amountMinor: 199899 }, { currency: 'USD' }]) expect(paymentSettlementEligible(order, { ...succeeded, ...patch })).toBe(false);
    expect(paymentSettlementEligible(order, { ...succeeded, card: 'unexpected sensitive payload' })).toBe(false);
  });
  it('converts exact minor amounts including awkward floating point fractions', () => {
    for (const [minor, decimal] of [[1, '0.01'], [29, '0.29'], [199900, '1999.00'], [1000000000, '10000000.00']] as const) {
      expect(rublesToMinor(decimal)).toBe(minor); expect(minorToRubles(minor)).toBe(decimal);
    }
  });
  it('rejects rounding, exponents, signs, whitespace, overflow and zero', () => {
    for (const value of ['0.00', '-1.00', '+1.00', '1', '1.1', '1.001', '1e3', ' 1.00', '01.00', '10000000.01', 'NaN', 'Infinity']) expect(() => rublesToMinor(value)).toThrow();
    for (const value of [0, -1, 0.29, NaN, Infinity, 1000000001]) expect(() => minorToRubles(value)).toThrow();
  });
  it('keeps the original day through February and preserves UTC time', () => {
    const anchor = new Date('2027-01-31T15:42:17.123Z');
    expect(monthlyBillingBoundary(anchor, 1).toISOString()).toBe('2027-02-28T15:42:17.123Z');
    expect(monthlyBillingBoundary(anchor, 2).toISOString()).toBe('2027-03-31T15:42:17.123Z');
    expect(monthlyBillingBoundary(anchor, 13).toISOString()).toBe('2028-02-29T15:42:17.123Z');
    expect(anchor.toISOString()).toBe('2027-01-31T15:42:17.123Z');
  });
  it('rejects invalid or unbounded renewal periods', () => {
    for (const offset of [-1, 0.1, NaN, Infinity, 1201]) expect(() => monthlyBillingBoundary(new Date(), offset)).toThrow();
    expect(() => monthlyBillingBoundary(new Date(NaN), 1)).toThrow();
  });
});
