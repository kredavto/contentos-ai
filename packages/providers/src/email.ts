import nodemailer from 'nodemailer';
import { ProviderRequestError, type EmailProvider, type OperationContext } from '@contentos/types';
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
    if(context.signal.aborted)throw new ProviderRequestError('PROVIDER_UNAVAILABLE',503,true);
    try{
    const result = await this.transport.sendMail({
      from: this.from, to: input.recipient, subject: input.subject, text: input.text,
      messageId: `<${context.idempotencyKey}@contentos.local>`,
    });
    if (!result.accepted?.length) throw new ProviderRequestError('PROVIDER_UNAVAILABLE',503,true);
    return { provider: 'smtp', externalId: String(result.messageId), internalId: context.internalId, metadata: {} };
    }catch(error){
      if(error instanceof ProviderRequestError)throw error;
      const responseCode=typeof error==='object'&&error!==null&&'responseCode' in error?error.responseCode:undefined;
      const command=typeof error==='object'&&error!==null&&'command' in error?error.command:undefined;
      const rejectedBeforeAcceptance=typeof command==='string'&&/^(CONN|EHLO|HELO|STARTTLS|AUTH(?: .*)?|MAIL FROM|RCPT TO|DATA)$/.test(command);
      // QUIT or an unknown phase may fail after acceptance. Never infer rejection there.
      throw new ProviderRequestError('PROVIDER_UNAVAILABLE',503,rejectedBeforeAcceptance&&typeof responseCode==='number'&&responseCode>=400&&responseCode<600);
    }
  }
}
export class UnconfiguredEmailProvider implements EmailProvider {
  async send(): Promise<never> { throw new ProviderRequestError('CONFIGURATION_REQUIRED',503,true); }
}
