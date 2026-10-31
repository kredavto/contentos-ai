import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('reuses the disposable runner as a bounded non-publishing CI gate',()=>{
  const job=readFileSync('.github/workflows/ci.yml','utf8').split('\n  database-recovery:')[1]!;
  expect(job).toContain('timeout-minutes: 30');expect(job).toContain('contents: read');expect(job).toContain('pnpm test:local --recovery');
  expect(job).not.toContain('secrets.');expect(job).not.toContain('upload-artifact');
});
it('uses a per-run media tag, exact image cleanup and scoped container ownership',()=>{
  const runner=readFileSync('scripts/test-local.mjs','utf8');
  expect(runner).toContain('const mediaImage=`${prefix}-media:local`');
  expect(runner).not.toContain('contentos-test-media:local');
  expect(runner).toContain("['image','rm',mediaImage]");
  expect(runner).toContain("if(mediaImageAttempted)");
  expect(runner).toContain("'--label',`contentos.test.owner=${prefix}`");
  expect(runner).not.toContain('system prune');
  const recovery=runner.split('if(recovery)await run(')[1]!.split('if(browser)')[0]!;
  expect(recovery).toContain("'--import','tsx','scripts/database-recovery.ts'");
  expect(recovery).not.toContain('...env');expect(recovery).not.toContain('...process.env');
});
it('checks ownership before database clients and writes; child migration does not inherit ambient environment',()=>{
  const script=readFileSync('scripts/database-recovery.ts','utf8');
  expect(script.indexOf('assertRecoveryOwnership(inspection.stdout')).toBeLessThan(script.indexOf('source=createDatabase'));
  expect(script).toContain("['--host',dockerHost,'exec',container,...args]");
  expect(script).toContain("['--import','tsx','packages/db/src/migrate.ts']");
  expect(script).not.toContain('...process.env');expect(script).not.toContain('error.message');
  expect(script).toContain('recoveryFailure(stage)');
});

it('refuses mismatched ownership before any writes and never emits inspect secrets',()=>{
  const directory=mkdtempSync(join(tmpdir(),'recovery-contract-'));
  try{
    const docker=join(directory,'docker'),trace=join(directory,'trace');
    writeFileSync(docker,`#!/usr/bin/env node
const fs=require('node:fs');
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify({args:process.argv.slice(2),leaked:!!process.env.OPENAI_API_KEY||!!process.env.PGPASSWORD})+'\\n');
console.log('sentinel-inspect-secret');
`,{mode:0o755});
    const result=spawnSync(process.execPath,['--import','tsx','scripts/database-recovery.ts'],{encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,NODE_ENV:'test',TEST_DATABASE_URL:'postgresql://contentos:sentinel-db-secret@127.0.0.1:55487/contentos_test',RECOVERY_CONTAINER:'contentos-test-0123456789ab-db',RECOVERY_DOCKER:docker,RECOVERY_DOCKER_HOST:'unix:///fixture/socket',RECOVERY_OWNER:'contentos-test-0123456789ab',OPENAI_API_KEY:'sentinel-api-secret',PGPASSWORD:'sentinel-pg-secret'}});
    expect(result.status).toBe(1);expect(result.stdout).toBe('');
    expect(result.stderr).toBe('{"event":"database_recovery_failed","stage":"ownership"}\n');
    const calls=readFileSync(trace,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    expect(calls).toHaveLength(1);expect(calls[0]).toEqual({args:['--host','unix:///fixture/socket','inspect','contentos-test-0123456789ab-db'],leaked:false});
  }finally{rmSync(directory,{recursive:true,force:true});}
});
it.each(['build','media_start'])('cleans only owned media image/container names after %s failure',failure=>{
  const directory=mkdtempSync(join(tmpdir(),'recovery-cleanup-'));
  try{
    const docker=join(directory,'docker'),trace=join(directory,'trace');
    writeFileSync(docker,`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(trace)},JSON.stringify(args)+'\\n');
if(args[0]==='context')console.log('unix:///fixture/socket');
if(args[0]==='build'&&${JSON.stringify(failure)}==='build')process.exit(1);
if(args[0]==='run'&&args.includes('--network')&&${JSON.stringify(failure)}==='media_start')process.exit(1);
if(args[0]==='image'&&args[1]==='ls')console.log('fixture-image-id');
if(args[0]==='container'&&args[1]==='ls')console.log('fixture-container-id');
`,{mode:0o755});
    const result=spawnSync(process.execPath,['scripts/test-local.mjs','--recovery'],{encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,HOME:process.env.HOME,DOCKER_PATH:docker}});
    expect(result.status).toBe(1);
    const calls=readFileSync(trace,'utf8').trim().split('\n').map(line=>JSON.parse(line) as string[]);
    const build=calls.find(call=>call[0]==='build')!;
    const tag=build[build.indexOf('-t')+1]!;
    expect(tag).toMatch(/^contentos-test-[a-f0-9]{12}-media:local$/);
    expect(calls).toContainEqual(['image','rm',tag]);
    for(const call of calls.filter(call=>call[0]==='rm'))expect(call).toEqual(['rm','-f','-v',expect.stringMatching(/^contentos-test-[a-f0-9]{12}-(?:db|redis|media)$/)]);
    expect(calls.some(call=>call.includes('prune'))).toBe(false);
    expect(result.stdout).toContain('Disposable test resources removed.');
  }finally{rmSync(directory,{recursive:true,force:true});}
});
