import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { YooKassaPaymentProvider, paymentsFromEnvironment } from '../packages/providers/src/yookassa';
import { ProviderRequestError, type CreatePayment, type PaymentMutationContext } from '../packages/types/src/index';
const paymentId = '23d93cac-000f-5000-8000-126628f15141';
const refundId = '216749f7-0016-50be-b000-078d43a63ae4';
const config = { shopId: '100500', secretKey: 'fixture-not-a-real-secret', test: true, returnOrigin: 'https://contentos.example' };
const context = (): PaymentMutationContext => ({ tenantId: randomUUID(), internalId: randomUUID(), idempotencyKey: randomUUID(), correlationId: randomUUID(), signal: new AbortController().signal, firstSubmittedAt: new Date().toISOString() });
const input = (): CreatePayment => ({ mode: 'CHECKOUT', amountMinor: 199900, currency: 'RUB', description: 'Подписка CREATOR', returnUrl: 'https://contentos.example/billing/return', saveMethod: false, receipt: { customerEmail: 'billing@example.test', vatCode: 11, taxSystemCode: 1, mode: 'full_payment', subject: 'service' } });
const response = (ctx: PaymentMutationContext) => ({ id: paymentId, status: 'pending', paid: false, amount: { value: '1999.00', currency: 'RUB' }, recipient: { account_id: '100500' }, test: true, metadata: { order_id: ctx.internalId }, confirmation: { type: 'redirect', confirmation_url: `https://yoomoney.ru/checkout/${paymentId}` } });
const reference = (ctx: PaymentMutationContext) => ({ provider: 'yookassa', internalId: ctx.internalId, externalId: paymentId, metadata: { merchantId: '100500', test: true } });
afterEach(() => vi.restoreAllMocks());
describe('YooKassa server adapter', () => {
  it('keeps missing or production-test configuration from enabling payments', () => {
    const env = { PAYMENTS_ENABLED: 'false', PAYMENT_PROVIDER: 'disabled', NODE_ENV: 'test', APP_URL: config.returnOrigin };
    expect(paymentsFromEnvironment(env)).toBeNull();
    expect(() => paymentsFromEnvironment({ ...env, PAYMENTS_ENABLED: 'true', PAYMENT_PROVIDER: 'yookassa' })).toThrow('CONFIGURATION_REQUIRED');
    const configured = { ...env, PAYMENTS_ENABLED: 'true', PAYMENT_PROVIDER: 'yookassa', YOOKASSA_SHOP_ID: config.shopId, YOOKASSA_SECRET_KEY: config.secretKey, YOOKASSA_TEST_MODE: 'true' };
    expect(paymentsFromEnvironment(configured)?.name).toBe('yookassa');
    expect(() => paymentsFromEnvironment({ ...configured, NODE_ENV: 'production' })).toThrow('CONFIGURATION_REQUIRED');
  });
  it('discovers the internal order only from authenticated payment lookup', async () => {
    const ctx=context(), body=response(ctx), request=vi.fn<typeof fetch>(async()=>Response.json(body));
    const provider=new YooKassaPaymentProvider(config,request);
    const result=await provider.inspect(paymentId,{correlationId:ctx.correlationId,signal:ctx.signal});
    expect(result.observation.internalId).toBe(ctx.internalId);expect(result.reference.metadata).toMatchObject({merchantId:config.shopId,test:true});
    expect(request.mock.calls[0]![1]!.method).toBe('GET');
    await expect(provider.inspect('../../secrets',{correlationId:ctx.correlationId,signal:ctx.signal})).rejects.toThrow('INVALID_INPUT');
  });
  it('does not send a pre-aborted operation or expose its abort reason', async () => {
    const controller = new AbortController(); controller.abort(new Error(config.secretKey));
    const request = vi.fn<typeof fetch>();
    await expect(new YooKassaPaymentProvider(config, request).create(input(), { ...context(), signal: controller.signal })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(request).not.toHaveBeenCalled();
  });
  it('uses exact amounts, stable keys, merchant credentials and an explicit receipt', async () => {
    const ctx = context(), request = vi.fn<typeof fetch>(async () => Response.json(response(ctx)));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const provider = new YooKassaPaymentProvider(config, request);
    const result = await provider.create(input(), ctx);
    await provider.create(input(), ctx);
    const [url, options] = request.mock.calls[0]!;
    expect(url).toBe('https://api.yookassa.ru/v3/payments'); expect(options?.redirect).toBe('error');
    expect(options?.headers).toMatchObject({ 'Idempotence-Key': ctx.idempotencyKey, Authorization: `Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`).toString('base64')}` });
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({ capture: true, save_payment_method: false, amount: { value: '1999.00', currency: 'RUB' }, metadata: { order_id: ctx.internalId }, receipt: { customer: { email: 'billing@example.test' }, tax_system_code: 1, items: [{ quantity: '1.000', vat_code: 11, payment_mode: 'full_payment', payment_subject: 'service', measure: 'piece' }] } });
    expect(request.mock.calls[1]?.[1]?.body).toBe(options?.body);
    expect(result.observation).toMatchObject({ status: 'PENDING', amountMinor: 199900, merchantId: '100500', test: true });
    expect(result.savedPaymentMethodId).toBeNull();
    expect(JSON.stringify(log.mock.calls)).not.toContain(config.secretKey); expect(JSON.stringify(log.mock.calls)).not.toContain('billing@example.test');
  });
  it('sends a renewal with only the saved method and exposes no card payload', async () => {
    const ctx = context(); const request = vi.fn<typeof fetch>(async () => Response.json({ ...response(ctx), status: 'succeeded', paid: true, confirmation: undefined, receipt_registration: 'succeeded', payment_method: { id: 'saved-method', saved: true, card: { first6: '555555', last4: '4444' } } }));
    const checkout = input(); const result = await new YooKassaPaymentProvider(config, request).create({ mode: 'RENEWAL', amountMinor: checkout.amountMinor, currency: 'RUB', description: checkout.description, receipt: checkout.receipt, paymentMethodId: 'saved-method' }, ctx);
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body.payment_method_id).toBe('saved-method'); expect(body.confirmation).toBeUndefined(); expect(body.save_payment_method).toBeUndefined();
    expect(result.savedPaymentMethodId).toBe('saved-method'); expect(result.receiptStatus).toBe('SUCCEEDED'); expect(JSON.stringify(result)).not.toContain('555555');
  });
  it('reads authenticated status and does not expose an unsaved method', async () => {
    const ctx = context(); const request = vi.fn<typeof fetch>(async () => Response.json({ ...response(ctx), status: 'waiting_for_capture', paid: true, payment_method: { id: 'unsaved', saved: false } }));
    const result = await new YooKassaPaymentProvider(config, request).get(reference(ctx), ctx);
    expect(result.observation.status).toBe('WAITING_CAPTURE'); expect(result.savedPaymentMethodId).toBeNull();
    expect(request.mock.calls[0]?.[0]).toBe(`https://api.yookassa.ru/v3/payments/${paymentId}`);
    expect(request.mock.calls[0]?.[1]?.method).toBe('GET'); expect(request.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
  it('rejects substituted identity, money, confirmation URLs and malformed states', async () => {
    const ctx = context();
    for (const patch of [{ recipient: { account_id: 'another' } }, { test: false }, { metadata: { order_id: randomUUID() } }, { amount: { value: '1998.99', currency: 'RUB' } }, { amount: { value: '1999.00', currency: 'USD' } }, { status: 'succeeded', paid: false }, { confirmation: { type: 'redirect', confirmation_url: 'https://yoomoney.ru.attacker.example/pay' } }, { confirmation: undefined }, { status: 'invented' }]) {
      const request = vi.fn<typeof fetch>(async () => Response.json({ ...response(ctx), ...patch }));
      await expect(new YooKassaPaymentProvider(config, request).create(input(), ctx)).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED', definitiveRejection: false });
      expect(request).toHaveBeenCalledTimes(1);
    }
    const request = vi.fn<typeof fetch>(async () => Response.json({ ...response(ctx), id: refundId }));
    await expect(new YooKassaPaymentProvider(config, request).get(reference(ctx), ctx)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
  it('validates local inputs and expired replay windows without issuing requests', async () => {
    const ctx = context(), request = vi.fn<typeof fetch>(), provider = new YooKassaPaymentProvider(config, request);
    for (const patch of [{ amountMinor: 0.29 }, { returnUrl: 'not-a-url' }, { returnUrl: 'https://attacker.example/return' }, { returnUrl: 'http://contentos.example/return' }, { receipt: undefined }, { description: 'a'.repeat(129) }]) await expect(provider.create({ ...input(), ...patch } as CreatePayment, ctx)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    for (const firstSubmittedAt of [new Date(Date.now() - 23 * 3600000).toISOString(), new Date(Date.now() + 60000).toISOString()]) await expect(provider.create(input(), { ...ctx, firstSubmittedAt })).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
    await expect(provider.get({ ...reference(ctx), externalId: '../../refunds' }, ctx)).rejects.toThrow();
    await expect(provider.get({ ...reference(ctx), internalId: randomUUID() }, ctx)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(() => new YooKassaPaymentProvider({ ...config, secretKey: '' }, request)).toThrow('CONFIGURATION_REQUIRED');
  });
  it('never retries uncertain sends or leaks transport/provider messages', async () => {
    const ctx = context(); const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    for (const transport of [async () => { throw new Error(config.secretKey); }, async () => new Response(config.secretKey, { status: 500 }), async () => Response.json({ type: 'error', code: 'internal_server_error', id: randomUUID() }, { status: 500 }), async () => new Response('x'.repeat(128001)), async () => Response.json({ private: config.secretKey })]) {
      const request = vi.fn<typeof fetch>(transport);
      const error = await new YooKassaPaymentProvider(config, request).create(input(), ctx).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(ProviderRequestError); expect(error).toMatchObject({ code: 'RECONCILIATION_REQUIRED', definitiveRejection: false }); expect(String(error)).not.toContain(config.secretKey); expect(request).toHaveBeenCalledTimes(1);
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain(config.secretKey);
  });
  it('distinguishes verified rejections from an invalid error envelope', async () => {
    const ctx = context();
    for (const status of [400, 401, 403, 404, 429]) {
      const request = vi.fn<typeof fetch>(async () => Response.json({ type: 'error', code: 'fixture', id: randomUUID(), description: config.secretKey }, { status }));
      await expect(new YooKassaPaymentProvider(config, request).create(input(), ctx)).rejects.toMatchObject({ definitiveRejection: true });
    }
    await expect(new YooKassaPaymentProvider(config, async () => new Response('unauthorized', { status: 401 })).create(input(), ctx)).rejects.toMatchObject({ definitiveRejection: false });
  });
  it('creates and reads refunds, checks the source payment and exact amount', async () => {
    const ctx = context(), payment = reference(context()), refund = { id: refundId, payment_id: paymentId, status: 'pending', amount: { value: '1999.00', currency: 'RUB' } };
    const request = vi.fn<typeof fetch>(async () => Response.json(refund)); const provider = new YooKassaPaymentProvider(config, request);
    const checkout = input(); const result = await provider.refund(payment, { mode: 'PARTIAL', amountMinor: checkout.amountMinor, currency: 'RUB', description: checkout.description, receipt: checkout.receipt }, ctx);
    expect(result.status).toBe('PENDING'); expect(result.paymentExternalId).toBe(paymentId);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({ payment_id: paymentId, receipt: { customer: { email: 'billing@example.test' } } });
    await provider.getRefund(result.reference, ctx); expect(request.mock.calls[1]?.[0]).toBe(`https://api.yookassa.ru/v3/refunds/${refundId}`);
    await provider.refund(payment, { mode: 'FULL', amountMinor: checkout.amountMinor, currency: 'RUB', description: checkout.description }, { ...ctx, idempotencyKey: randomUUID() });
    expect(JSON.parse(String(request.mock.calls[2]?.[1]?.body)).receipt).toBeUndefined();
    const bad = new YooKassaPaymentProvider(config, async () => Response.json({ ...refund, payment_id: refundId }));
    await expect(bad.getRefund(result.reference, ctx)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
  });
});
