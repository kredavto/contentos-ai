import net from 'node:net';
import type { ConnectionOptions } from 'node:tls';
import nodemailer, { type SendMailOptions, type SMTPTransportOptions } from 'nodemailer';
import { ProviderRequestError, type EmailProvider, type OperationContext, type ProviderReference } from '@contentos/types';

type SmtpResult = { accepted?: readonly unknown[]; messageId?: unknown };
type SmtpTransport = { sendMail(input: SendMailOptions): Promise<SmtpResult>; close(): void };
export interface SmtpEmailOptions {
  deadlineMs?: number;
  connectionDeadlineMs?: number;
  /** Trusted test seam, never sourced from SMTP_URL. */
  createTransport?: (options: SMTPTransportOptions) => SmtpTransport;
}
const unavailable = (definitive = false) => new ProviderRequestError('PROVIDER_UNAVAILABLE',503,definitive);
function classify(error: unknown): ProviderRequestError {
  if(error instanceof ProviderRequestError)return error;
  const responseCode=typeof error==='object'&&error!==null&&'responseCode' in error?error.responseCode:undefined;
  const command=typeof error==='object'&&error!==null&&'command' in error?error.command:undefined;
  const rejectedBeforeAcceptance=typeof command==='string'&&/^(CONN|EHLO|HELO|STARTTLS|AUTH(?: .*)?|MAIL FROM|RCPT TO|DATA)$/.test(command);
  // QUIT or an unknown phase may fail after acceptance. Never infer rejection there.
  return unavailable(rejectedBeforeAcceptance&&typeof responseCode==='number'&&responseCode>=400&&responseCode<600);
}
function configuration(url: string, requireTLS: boolean): SMTPTransportOptions {
  try {
    const parsed = new URL(url);
    if(!['smtp:','smtps:'].includes(parsed.protocol)||!parsed.hostname||parsed.hash||(parsed.pathname&&parsed.pathname!=='/'))throw new Error('Invalid SMTP URL');
    const options: SMTPTransportOptions = {
      host: parsed.hostname.replace(/^\[|\]$/g,''), port: parsed.port ? Number(parsed.port) : parsed.protocol==='smtps:' ? 465 : 587,
      secure: parsed.protocol==='smtps:', pool:false, connectionTimeout:5000, greetingTimeout:5000, socketTimeout:8000, dnsTimeout:5000,
    };
    if(parsed.username||parsed.password)options.auth={user:decodeURIComponent(parsed.username),pass:decodeURIComponent(parsed.password)};
    const seen=new Set<string>();
    for(const [key,value] of parsed.searchParams){
      if(seen.has(key))throw new Error('Duplicate option');seen.add(key);
      if(['connectionTimeout','greetingTimeout','socketTimeout','dnsTimeout'].includes(key))continue;
      if(['name','localAddress','servername','authMethod'].includes(key)){
        if(!value||value.length>512||/[\r\n\0]/.test(value))throw new Error('Invalid option');
        Object.assign(options,{[key]:value});continue;
      }
      if(['requireTLS','ignoreTLS','opportunisticTLS'].includes(key)){
        if(!['true','false'].includes(value))throw new Error('Invalid option');
        Object.assign(options,{[key]:value==='true'});continue;
      }
      if(['tls.rejectUnauthorized','tls.servername','tls.minVersion','tls.maxVersion','tls.ciphers','tls.ca'].includes(key)){
        const tls:ConnectionOptions=options.tls??{};
        if(key==='tls.rejectUnauthorized'){
          if(!['true','false'].includes(value))throw new Error('Invalid TLS option');tls.rejectUnauthorized=value==='true';
        }else if(key==='tls.minVersion'||key==='tls.maxVersion'){
          if(!['TLSv1.2','TLSv1.3'].includes(value))throw new Error('Invalid TLS version');
          Object.assign(tls,{[key.slice(4)]:value});
        }else{
          if(!value||value.length>65536||(key!=='tls.ca'&&/[\r\n\0]/.test(value)))throw new Error('Invalid TLS option');
          Object.assign(tls,{[key.slice(4)]:value});
        }
        options.tls=tls;continue;
      }
      // A proxy/service/pool/custom transport can replace getSocket or bypass SMTP.
      // An allowlist also prevents future URL options from silently bypassing ownership.
      throw new Error('Unsupported SMTP option');
    }
    if(requireTLS)options.requireTLS=true;
    return options;
  }catch{throw new ProviderRequestError('CONFIGURATION_REQUIRED',503,true);}
}
export class SmtpEmailProvider implements EmailProvider {
  private readonly configuration: SMTPTransportOptions;
  private readonly deadlineMs: number;
  private readonly connectionDeadlineMs: number;
  private readonly factory: (options: SMTPTransportOptions) => SmtpTransport;
  constructor(url: string, private readonly from: string, requireTLS = false, options: SmtpEmailOptions = {}) {
    this.configuration=configuration(url,requireTLS);
    this.deadlineMs=options.deadlineMs??30000;this.connectionDeadlineMs=options.connectionDeadlineMs??5000;
    for(const [value,maximum] of [[this.deadlineMs,30000],[this.connectionDeadlineMs,5000]] as const){
      if(!Number.isSafeInteger(value)||value<1||value>maximum)throw new ProviderRequestError('CONFIGURATION_REQUIRED',503,true);
    }
    this.factory=options.createTransport??(settings=>nodemailer.createTransport(settings));
  }
  async send(input: { recipient: string; subject: string; text: string }, context: OperationContext): Promise<ProviderReference> {
    if(context.signal.aborted)throw unavailable(true);
    return new Promise<ProviderReference>((resolve,reject)=>{
      let settled=false,dispatched=false;
      let raw:net.Socket|undefined,transport:SmtpTransport|undefined;
      let connectTimer:ReturnType<typeof setTimeout>|undefined;
      let pendingSocket:((error:Error)=>void)|undefined;
      const cleanup=()=>{
        clearTimeout(deadline);if(connectTimer)clearTimeout(connectTimer);
        context.signal.removeEventListener('abort',onAbort);
        raw?.destroy();
        const pending=pendingSocket;pendingSocket=undefined;try{pending?.(unavailable());}catch{/* An already-settled hook cannot replace the original outcome. */}
        // close() alone does not close an active non-pooled SMTP connection.
        // The raw socket above owns both plaintext and any TLS wrapper lifecycle.
        try{transport?.close();}catch{/* The owned socket has already been destroyed. */}
      };
      const finish=(error:unknown,result?:SmtpResult)=>{
        if(settled)return;settled=true;cleanup();
        if(error){reject(classify(error));return;}
        if(!result?.accepted?.length){reject(unavailable(true));return;}
        resolve({provider:'smtp',externalId:String(result.messageId),internalId:context.internalId,metadata:{}});
      };
      const onAbort=()=>finish(unavailable(!dispatched));
      const deadline=setTimeout(()=>finish(unavailable(!dispatched)),this.deadlineMs);
      context.signal.addEventListener('abort',onAbort,{once:true});
      if(context.signal.aborted){onAbort();return;}
      const getSocket:NonNullable<SMTPTransportOptions['getSocket']>=(settings,callback)=>{
        if(settled){callback(unavailable());return;}
        if(raw){callback(unavailable());return;}
        let handedOff=false;
        const failSocket=(error:Error)=>{if(handedOff)return;handedOff=true;pendingSocket=undefined;callback(error);};
        pendingSocket=failSocket;
        connectTimer=setTimeout(()=>finish(unavailable()),this.connectionDeadlineMs);
        try{
          // Do not give Nodemailer an unconnected socket: late DNS completion
          // could otherwise connect it after the caller's deadline has fired.
          raw=net.createConnection({host:settings.host??'localhost',port:Number(settings.port)||(settings.secure?465:587),...(settings.localAddress?{localAddress:settings.localAddress}:{})});
          raw.on('error',()=>{/* Nodemailer/pending connection own error settlement; absorb late errors after cancellation. */});
          raw.once('error',error=>{if(!handedOff)finish(error);});
          raw.once('connect',()=>{
            if(settled){raw?.destroy();return;}
            if(handedOff)return;handedOff=true;pendingSocket=undefined;
            if(connectTimer)clearTimeout(connectTimer);
            // secured:false lets Nodemailer perform implicit SMTPS or STARTTLS.
            try{callback(null,{connection:raw,secured:false});}catch(error){finish(error);}
          });
        }catch(error){finish(error);}
      };
      try{
        transport=this.factory({...this.configuration,tls:this.configuration.tls?{...this.configuration.tls}:undefined,auth:this.configuration.auth?{...this.configuration.auth}:undefined,getSocket});
        if(settled){transport.close();return;}
        dispatched=true;
        void transport.sendMail({from:this.from,to:input.recipient,subject:input.subject,text:input.text,messageId:`<${context.idempotencyKey}@contentos.local>`})
          .then(result=>finish(null,result),error=>finish(error??unavailable()));
      }catch(error){finish(error);}
    });
  }
}
export class UnconfiguredEmailProvider implements EmailProvider {
  async send(): Promise<never> { throw new ProviderRequestError('CONFIGURATION_REQUIRED',503,true); }
}
