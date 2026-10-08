import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll } from 'vitest';
import { createDatabase } from '../../packages/db/src/index';
/** Each suite owns exactly one disposable database; never drops the supplied database. */
export function isolatedTestDatabase(url:string|undefined){
  if(url&&!new URL(url).pathname.endsWith('_test'))throw new Error('Dedicated test database required');
  const admin=createDatabase(url??'postgresql://localhost/unused_test'),name=`contentos_${randomUUID().replaceAll('-','')}_test`,isolated=new URL(url??'postgresql://localhost/unused_test');isolated.pathname=`/${name}`;
  const database=createDatabase(isolated.href);let created=false;
  beforeAll(async()=>{await admin.client`create database ${admin.client(name)}`;created=true;await promisify(execFile)(process.execPath,[fileURLToPath(import.meta.resolve('tsx/cli')),'packages/db/src/migrate.ts'],{cwd:fileURLToPath(new URL('../../',import.meta.url)),env:{...process.env,DATABASE_URL:isolated.href}});},60000);
  afterAll(async()=>{await database.close();if(created)await admin.client`drop database ${admin.client(name)}`;await admin.close();});
  return database;
}
