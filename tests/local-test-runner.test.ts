import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtemp,writeFile,readFile,readdir,rm,chmod} from 'node:fs/promises';
import {join,resolve,delimiter} from 'node:path';
import {tmpdir} from 'node:os';
import {expect,it} from 'vitest';
const exec=promisify(execFile),script=resolve('scripts/test-local.mjs');
async function fixture(fail=''){
  const directory=await mkdtemp(join(tmpdir(),"test local's harness-"));
  const docker=join(directory,'docker-fixture'),pnpm=join(directory,'pnpm-fixture.cjs');
  await writeFile(docker,`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),root=process.env.TEST_LOCAL_FIXTURE_DIR,args=process.argv.slice(2),file=path.join(root,'containers.json');
let names=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
fs.appendFileSync(path.join(root,'docker.jsonl'),JSON.stringify(args)+'\\n');
if(args[0]==='run'){names.push(args[args.indexOf('--name')+1]);fs.writeFileSync(file,JSON.stringify(names));}
if(args[0]==='context')process.stdout.write('unix:///fixture/docker.sock');
if(args[0]==='port')process.stdout.write('127.0.0.1:'+(args[2]==='5432/tcp'?'55487':'55488'));
if(args[0]==='container'&&args[1]==='ls'){const filter=args.at(-1);if(names.some(n=>filter==='name=^/'+n+'$'))process.stdout.write('fixture-id');}
if(args[0]==='rm'&&process.env.TEST_LOCAL_FAIL==='cleanup')process.exit(7);
if(args[0]==='rm')fs.writeFileSync(file,JSON.stringify(names.filter(n=>n!==args.at(-1))));
`);await chmod(docker,0o700);
  await writeFile(pnpm,`const fs=require('node:fs'),path=require('node:path');const args=process.argv.slice(2);fs.appendFileSync(path.join(process.env.TEST_LOCAL_FIXTURE_DIR,'pnpm.jsonl'),JSON.stringify({args,database:process.env.TEST_DATABASE_URL,redis:process.env.TEST_REDIS_URL,tmp:process.env.TMPDIR})+'\\n');if(args[0]===process.env.TEST_LOCAL_FAIL)process.exit(7);if(process.env.TEST_LOCAL_FAIL==='wait'&&args[0]==='typecheck')setInterval(()=>{},1000);`);
  const env={...process.env,TMPDIR:directory,DOCKER_CONTEXT:'fixture-context',DOCKER_PATH:docker,npm_execpath:pnpm,TEST_LOCAL_FIXTURE_DIR:directory,TEST_LOCAL_FAIL:fail,TEST_DATABASE_URL:'postgresql://unused.invalid/do_not_use',TEST_REDIS_URL:'redis://unused.invalid'};
  return {directory,env};
}
it('isolates services, provisions media wrappers, migrates before checks and removes only owned resources',async()=>{
  const f=await fixture();try{
    const result=await exec(process.execPath,[script],{env:f.env});expect(result.stdout).toContain('Local verification passed.');
    const calls=(await readFile(join(f.directory,'pnpm.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as {args:string[];database:string;redis:string;tmp:string});
    expect(calls.map(call=>call.args)).toEqual([['--filter','@contentos/db','migrate'],['typecheck'],['lint'],['test']]);
    for(const call of calls){expect(new URL(call.database).pathname).toBe('/contentos_test');expect(new URL(call.database).hostname).toBe('127.0.0.1');expect(call.redis).toBe('redis://127.0.0.1:55488/14');}
    expect(await readFile(join(f.directory,'containers.json'),'utf8')).toBe('[]');
    expect((await readdir(f.directory)).some(name=>name.startsWith('contentos-test-'))).toBe(false);
    const docker=await readFile(join(f.directory,'docker.jsonl'),'utf8');expect(docker).toContain('/usr/bin/ffmpeg');expect(docker).toContain('/usr/bin/ffprobe');expect(docker).not.toContain('prune');
    expect(result.stdout).not.toContain(new URL(calls[0]!.database).password);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
it('resolves Docker from the original PATH before media wrappers restrict PATH',async()=>{
  const f=await fixture();try{
    const result=await exec(process.execPath,[script],{env:{...f.env,DOCKER_PATH:'docker-fixture',PATH:f.directory+delimiter+(process.env.PATH??'')}});
    expect(result.stdout).toContain('Local verification passed.');
    const calls=(await readFile(join(f.directory,'docker.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line) as string[]);
    expect(calls.some(args=>args.includes('/usr/bin/ffmpeg'))).toBe(true);
    expect(calls.some(args=>args.includes('/usr/bin/ffprobe'))).toBe(true);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
it('fails the run on a failed check and still removes containers and temporary files',async()=>{
  const f=await fixture('typecheck');try{
    await expect(exec(process.execPath,[script],{env:f.env})).rejects.toMatchObject({code:1});
    expect(await readFile(join(f.directory,'containers.json'),'utf8')).toBe('[]');
    expect((await readdir(f.directory)).some(name=>name.startsWith('contentos-test-'))).toBe(false);
    const log=await readFile(join(f.directory,'pnpm.jsonl'),'utf8');expect(log).not.toContain('"lint"');expect(log).not.toContain('"test"');
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
it('rejects unsupported flags and paths before provisioning Docker resources',async()=>{
  for(const args of [['--unknown'],['--e2e','../outside.spec.ts'],['--recovery','--unknown'],['--e2e','--recovery']])await expect(exec(process.execPath,[script,...args])).rejects.toMatchObject({code:2});
});

it('runs guarded recovery after migrations/checks and cleans up if an unowned mock container is rejected',async()=>{
  const f=await fixture();try{
    const run=exec(process.execPath,[script,'--recovery'],{env:f.env});
    await expect(run).rejects.toMatchObject({code:1,stderr:expect.stringContaining('"event":"database_recovery_failed","stage":"ownership"')});
    const calls=(await readFile(join(f.directory,'pnpm.jsonl'),'utf8')).trim().split('\n').map(line=>(JSON.parse(line) as {args:string[]}).args);
    expect(calls).toEqual([['--filter','@contentos/db','migrate'],['typecheck'],['lint']]);
    expect(await readFile(join(f.directory,'containers.json'),'utf8')).toBe('[]');
    expect((await readdir(f.directory)).some(name=>name.startsWith('contentos-test-'))).toBe(false);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});

it('terminates the active check and cleans up on SIGTERM',async()=>{
  const f=await fixture('wait');const child=spawn(process.execPath,[script],{env:f.env,stdio:'ignore'});
  const done=new Promise<number|null>(resolve=>child.once('close',resolve));
  try{
    const deadline=Date.now()+10000;let ready=false;
    while(Date.now()<deadline){const log=await readFile(join(f.directory,'pnpm.jsonl'),'utf8').catch(()=> '');if(log.includes('"typecheck"')){ready=true;break;}await delay(50);}
    expect(ready).toBe(true);child.kill('SIGTERM');expect(await done).toBe(143);
    expect(await readFile(join(f.directory,'containers.json'),'utf8')).toBe('[]');
    expect((await readdir(f.directory)).some(name=>name.startsWith('contentos-test-'))).toBe(false);
  }finally{if(child.exitCode===null)child.kill('SIGTERM');await done;await rm(f.directory,{recursive:true,force:true});}
});
it('reports failed cleanup and retains its temporary directory for recovery',async()=>{
  const f=await fixture('cleanup');try{
    await expect(exec(process.execPath,[script],{env:f.env})).rejects.toMatchObject({code:1,stdout:expect.stringContaining('Some test resources remain.')});
    expect(JSON.parse(await readFile(join(f.directory,'containers.json'),'utf8'))).toHaveLength(3);
    expect((await readdir(f.directory)).some(name=>name.startsWith('contentos-test-'))).toBe(true);
  }finally{await rm(f.directory,{recursive:true,force:true});}
});
