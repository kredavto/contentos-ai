import { URL } from 'node:url';
import process from 'node:process';
import console from 'node:console';
import { readFile, appendFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const path=new URL('../.env',import.meta.url);
const source=await readFile(path,'utf8');
if(/^NODE_ENV\s*=\s*["']?production/m.test(source)||process.env.NODE_ENV==='production')throw new Error('Local setup cannot modify a production environment');
const hasKeys=/^CREDENTIAL_ENCRYPTION_KEYS\s*=\s*\S/m.test(source),hasActive=/^CREDENTIAL_ACTIVE_KEY_ID\s*=\s*\S/m.test(source);
if(hasKeys!==hasActive)throw new Error('Complete both existing credential key settings; no key was changed');
if(!hasKeys){await appendFile(path,`\n# Generated locally; keep this key private and backed up.\nCREDENTIAL_ENCRYPTION_KEYS='${JSON.stringify({v1:randomBytes(32).toString('base64')})}'\nCREDENTIAL_ACTIVE_KEY_ID=v1\n`,{mode:0o600});await chmod(path,0o600);console.info('Local encryption key added to ignored .env.');}
else console.info('Existing encryption key settings preserved.');
