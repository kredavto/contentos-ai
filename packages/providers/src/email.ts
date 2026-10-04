import nodemailer from 'nodemailer';
import { DomainError, type EmailProvider, type OperationContext } from '@contentos/types';
export class SmtpEmailProvider implements EmailProvider {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  constructor(url: string, private readonly from: string, requireTLS = false) {
    const connection = new URL(url);
    connection.searchParams.set('connectionTimeout', '5000');
    connection.searchParams.set('greetingTimeout', '5000');
    connection.searchParams.set('socketTimeout', '8000');
    if (requireTLS) connection.searchParams.set('requireTLS', 'true');
    this.transport = nodemailer.createTransport(connection.toString());
  }
  async send(input: { recipient: string; subject: string; text: string }, context: OperationContext) {
    context.signal.throwIfAborted();
    const result = await this.transport.sendMail({
      from: this.from, to: input.recipient, subject: input.subject, text: input.text,
      messageId: `<${context.idempotencyKey}@contentos.local>`,
    });
    if (!result.accepted?.length) throw new DomainError('PROVIDER_UNAVAILABLE', 503);
    return { provider: 'smtp', externalId: String(result.messageId), internalId: context.internalId, metadata: {} };
  }
}
export class UnconfiguredEmailProvider implements EmailProvider {
  async send(): Promise<never> { throw new DomainError('CONFIGURATION_REQUIRED', 503); }
}
