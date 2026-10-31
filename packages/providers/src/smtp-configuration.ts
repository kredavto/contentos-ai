import type { ConnectionOptions } from 'node:tls';
import type { SMTPTransportOptions } from 'nodemailer';
import { ProviderRequestError } from '@contentos/types';

// Pure URL validation shared by the SMTP adapter and offline preflight.
export function smtpConfiguration(url: string, requireTLS: boolean): SMTPTransportOptions {
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
