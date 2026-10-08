// Execute inside a running web container configured with isolated test services.
import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { access } from 'node:fs/promises';
assert.notEqual(process.getuid?.(),0);
await assert.rejects(access('/app/.env'));
await assert.rejects(access('/app/node_modules/.bin/vitest'));
const origin='http://127.0.0.1:3000';
async function request(path,headers={}){
  return globalThis.fetch(new URL(path,origin),{headers,redirect:'manual',signal:globalThis.AbortSignal.timeout(15000)});
}
const health=await request('/api/health');
assert.equal(health.status,200);
assert.equal((await health.json()).status,'ok');
const home=await request('/');
assert.equal(home.status,200);
const html=await home.text();
assert.match(html,/CONTENTOS/i);
const assets=[...new Set([...html.matchAll(/(?:src|href)="([^"<>]*\/_next\/static\/[^"<>]+)"/g)].map(match=>match[1]))];
assert.ok(assets.some(path=>path.endsWith('.css')),'Rendered page must reference bundled CSS');
assert.ok(assets.some(path=>path.endsWith('.js')),'Rendered page must reference bundled JavaScript');
for(const path of assets){
  const asset=await request(path);
  assert.equal(asset.status,200,`Missing static asset: ${path}`);
  assert.ok((await asset.arrayBuffer()).byteLength>0);
}
assert.equal((await request('/register')).status,200);
assert.equal((await request('/api/me')).status,401,'Configured anonymous API must reject authentication, not fail configuration');
assert.equal((await request('/api/me',{cookie:`contentos_session=${randomBytes(32).toString('base64url')}`})).status,401,'Unknown well-formed session must be checked against the database');
console.info(`Web image: non-root, no runtime env/dev test runner, HTML, ${assets.length} static assets, health and database session lookup passed.`);
