import process from 'node:process';
import {setTimeout,clearTimeout} from 'node:timers';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2).filter(arg=>arg!=='--');
const recovery=args[0]==='--recovery';
if(recovery)args.shift();
const browser=args[0]==='--e2e';
const specs=browser?args.slice(1):[];
if((args.length&&!browser)||specs.some(spec=>!/^tests\/e2e\/[a-z0-9-]+\.spec\.ts$/.test(spec)||!existsSync(join(root,spec)))){
  process.stderr.write('Usage: pnpm test:local [--recovery] [--e2e [tests/e2e/name.spec.ts ...]]\n');process.exit(2);
}
if(process.platform==='win32'){process.stderr.write('test:local requires macOS or Linux and Docker.\n');process.exit(2);}
const dockerCommand=process.env.DOCKER_PATH??(existsSync('/Applications/Docker.app/Contents/Resources/bin/docker')?'/Applications/Docker.app/Contents/Resources/bin/docker':'docker');
// Media subprocesses deliberately restrict PATH; resolve Docker before that restriction.
const docker=dockerCommand.includes('/')?resolve(dockerCommand):(process.env.PATH??'').split(delimiter).map(path=>resolve(path,dockerCommand)).find(path=>existsSync(path))??dockerCommand;
const prefix=`contentos-test-${randomBytes(6).toString('hex')}`;
const names={db:`${prefix}-db`,redis:`${prefix}-redis`,media:`${prefix}-media`};
const mediaImage=`${prefix}-media:local`;
const created=[];
let mediaImageAttempted=false;
const password=randomBytes(24).toString('hex');
let directory,active,stopping=false,verified=false;
function run(command,argv,{env=process.env,capture=false,cleanup=false}={}){
  if(stopping&&!cleanup)return Promise.reject(new Error('Interrupted'));
  return new Promise((resolveRun,reject)=>{
    const child=spawn(command,argv,{cwd:root,env,stdio:capture?['ignore','pipe','pipe']:'inherit',detached:true});
    if(!cleanup)active=child;
    let output='';
    if(capture){child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.resume();}
    child.once('error',()=>{if(active===child)active=null;reject(new Error(`Cannot start ${command}`));});
    child.once('close',(code)=>{if(active===child)active=null;if(code===0)resolveRun(output.trim());else reject(new Error(`${command} exited with status ${code??'signal'}`));});
  });
}
function stop(signal){
  if(stopping)return;
  stopping=true;process.exitCode=signal==='SIGINT'?130:143;
  if(active?.pid){
    const child=active;
    try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')process.stderr.write('Could not signal test process group.\n');}
    const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')process.stderr.write('Could not stop test process group.\n');}},5000);
    child.once('close',()=>clearTimeout(timer));timer.unref();
  }
}
process.on('SIGINT',()=>stop('SIGINT'));process.on('SIGTERM',()=>stop('SIGTERM'));
const pause=()=>new Promise(resolvePause=>setTimeout(resolvePause,500));
async function ready(name,command){
  const deadline=Date.now()+60000;
  while(Date.now()<deadline){
    if(stopping)throw new Error('Interrupted');
    try{await run(docker,['exec',name,...command],{capture:true});return;}catch(error){if(stopping)throw error;}
    await pause();
  }
  throw new Error(`Test service ${name} did not become ready within 60 seconds`);
}
async function port(name,containerPort){
  const mapping=await run(docker,['port',name,`${containerPort}/tcp`],{capture:true});
  const match=/^127\.0\.0\.1:(\d+)$/.exec(mapping);
  if(!match)throw new Error('Unexpected test service port mapping');
  return match[1];
}
async function freePort(value){
  await new Promise((resolvePort,reject)=>{
    const server=createServer();server.once('error',()=>reject(new Error(`Browser fixture port ${value} is occupied; stop that service first`)));
    server.listen(value,'127.0.0.1',()=>server.close(error=>error?reject(error):resolvePort()));
  });
}
const pnpm=(argv,env)=>process.env.npm_execpath?run(process.execPath,[process.env.npm_execpath,...argv],{env}):run('pnpm',argv,{env});
try{
  await run(docker,['info'],{capture:true});
  const dockerHost=(!process.env.DOCKER_CONTEXT&&process.env.DOCKER_HOST)||await run(docker,['context','inspect','--format','{{.Endpoints.docker.Host}}'],{capture:true});
  if(!dockerHost.startsWith('unix://'))throw new Error('test:local requires a local Unix-socket Docker engine');
  if(browser)for(const value of [1026,8026,8027,3187,3190])await freePort(value);
  directory=await mkdtemp(join(await realpath(tmpdir()),'contentos-test-'));
  process.stdout.write(`Disposable test run: ${prefix}\n`);
  mediaImageAttempted=true;
  await run(docker,['build','-f','docker/test-media.Dockerfile','-t',mediaImage,'.']);
  // Register names before starting: cleanup also covers interrupted Docker creation.
  created.push(names.db);
  await run(docker,['run','-d','--name',names.db,'--label',`contentos.test.owner=${prefix}`,'-e','POSTGRES_USER=contentos','-e','POSTGRES_PASSWORD','-e','POSTGRES_DB=contentos_test','-p','127.0.0.1::5432','postgres:17-alpine'],{env:{...process.env,POSTGRES_PASSWORD:password},capture:true});
  created.push(names.redis);
  await run(docker,['run','-d','--name',names.redis,'-p','127.0.0.1::6379','redis:7-alpine'],{capture:true});
  created.push(names.media);
  await run(docker,['run','-d','--name',names.media,'--network','none','--mount',`type=bind,src=${directory},dst=${directory}`,'--mount',`type=bind,src=${root},dst=${root},readonly`,mediaImage],{capture:true});
  await ready(names.db,['pg_isready','-U','contentos','-d','contentos_test']);await ready(names.redis,['redis-cli','ping']);
  const databaseUrl=`postgresql://contentos:${password}@127.0.0.1:${await port(names.db,5432)}/contentos_test`;
  const redisUrl=`redis://127.0.0.1:${await port(names.redis,6379)}/14`;
  // Explicit Node/socket paths also work in the provider's restricted PATH/HOME environment.
  const handler=join(directory,'media-command.cjs');
  await writeFile(handler,`const {spawn}=require('node:child_process');\nconst [binary,...args]=process.argv.slice(2);\nconst child=spawn(${JSON.stringify(docker)},['--host',${JSON.stringify(dockerHost)},'exec','-w',process.cwd(),${JSON.stringify(names.media)},'/usr/bin/'+binary,...args],{stdio:'inherit'});\nchild.on('error',()=>{process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});\n`);
  const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
  for(const binary of ['ffmpeg','ffprobe']){
    const path=join(directory,binary);
    await writeFile(path,`#!/bin/sh\nexec ${quote(process.execPath)} ${quote(handler)} ${quote(binary)} "$@"\n`);
    await chmod(path,0o700);
  }
  const env={...process.env,NODE_ENV:'test',DATABASE_URL:databaseUrl,TEST_DATABASE_URL:databaseUrl,REDIS_URL:redisUrl,TEST_REDIS_URL:redisUrl,TMPDIR:directory,FFMPEG_PATH:join(directory,'ffmpeg'),FFPROBE_PATH:join(directory,'ffprobe'),PLAYWRIGHT_WEB_MODE:'production'};
  const mediaEnv={...env,PATH:'/usr/bin:/bin',HOME:directory};
  await run(env.FFMPEG_PATH,['-version'],{env:mediaEnv,capture:true});await run(env.FFPROBE_PATH,['-version'],{env:mediaEnv,capture:true});
  await pnpm(['--filter','@contentos/db','migrate'],env);
  await pnpm(['typecheck'],env);await pnpm(['lint'],env);
  if(recovery)await run(process.execPath,['--import','tsx','scripts/database-recovery.ts'],{env:{
    PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:directory,NODE_ENV:'test',
    TEST_DATABASE_URL:databaseUrl,RECOVERY_CONTAINER:names.db,RECOVERY_DOCKER:docker,
    RECOVERY_DOCKER_HOST:dockerHost,RECOVERY_OWNER:prefix,
  }});
  if(browser)await pnpm(['build'],{...env,NODE_ENV:'production'});
  await pnpm(['test'],env);
  if(browser)await pnpm(['exec','playwright','test',...specs],env);
  verified=true;
}catch(error){process.stderr.write(`Local verification failed: ${error.message}\n`);process.exitCode||=1;}
finally{
  let clean=true;
  for(const name of [...created].reverse()){
    try{
      const found=await run(docker,['container','ls','-aq','--filter',`name=^/${name}$`],{capture:true,cleanup:true});
      if(found)await run(docker,['rm','-f','-v',name],{capture:true,cleanup:true});
    }catch{clean=false;process.stderr.write(`Cleanup failed for ${name}; remove it manually.\n`);}

  }
  if(mediaImageAttempted){
    try{const found=await run(docker,['image','ls','-q',mediaImage],{capture:true,cleanup:true});if(found)await run(docker,['image','rm',mediaImage],{capture:true,cleanup:true});}
    catch{clean=false;process.stderr.write('Disposable media image cleanup failed.\n');}
  }
  if(directory&&clean){try{await rm(directory,{recursive:true,force:true});}catch{clean=false;process.stderr.write(`Cleanup failed for ${directory}; remove it manually.\n`);}}
  if(!clean)process.exitCode||=1;
  process.stdout.write(clean?'Disposable test resources removed.\n':'Some test resources remain.\n');
  if(clean&&verified&&!stopping)process.stdout.write('Local verification passed.\n');
}
