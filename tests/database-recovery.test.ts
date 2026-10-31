import {expect,it} from 'vitest';
import {assertRecoveryMatch,normalizeSchemaDump,recoveryConfiguration,assertRecoveryOwnership,recoveryChildEnvironment,recoveryFailure,type RecoveryStage,type RecoverySnapshot} from '../scripts/database-recovery-support';

it('requires the disposable local recovery environment before connecting',()=>{
  const valid={NODE_ENV:'test',TEST_DATABASE_URL:'postgresql://contentos:fixture@127.0.0.1:55487/contentos_test',RECOVERY_CONTAINER:'contentos-test-0123456789ab-db',RECOVERY_DOCKER:'/fixture/docker',RECOVERY_DOCKER_HOST:'unix:///fixture/docker.sock',RECOVERY_OWNER:'contentos-test-0123456789ab'};
  expect(recoveryConfiguration(valid).url.pathname).toBe('/contentos_test');
  for(const override of [{NODE_ENV:'production'},{RECOVERY_CONTAINER:'development-db'},{RECOVERY_DOCKER:''},{RECOVERY_DOCKER:'docker'},{RECOVERY_DOCKER_HOST:'tcp://remote.invalid:2375'},{RECOVERY_DOCKER_HOST:''},{RECOVERY_OWNER:'other'},{RECOVERY_OWNER:''},{TEST_DATABASE_URL:'postgresql://contentos@remote.example:5432/contentos_test'},{TEST_DATABASE_URL:'postgresql://contentos@127.0.0.1:5432/production'},{TEST_DATABASE_URL:valid.TEST_DATABASE_URL+'?options=unsafe'},{TEST_DATABASE_URL:'invalid'}])expect(()=>recoveryConfiguration({...valid,...override})).toThrow('Disposable recovery environment required');
});
it('detects missing tables, changed rows, row counts and sequence state without printing data',()=>{
  const source:RecoverySnapshot={tables:[{name:'public.sample',rows:1,hash:'source-fingerprint'}],sequences:[{name:'drizzle.id_seq',value:'58',called:true}]};
  expect(()=>assertRecoveryMatch(source,structuredClone(source))).not.toThrow();
  for(const target of [{...source,tables:[]},{...source,tables:[{...source.tables[0]!,rows:0}]},{...source,tables:[{...source.tables[0]!,hash:'different'}]},{...source,sequences:[{...source.sequences[0]!,value:'57'}]},{...source,sequences:[{...source.sequences[0]!,called:false}]}])expect(()=>assertRecoveryMatch(source,target)).toThrow('Restored data or sequences differ');
});
it('ignores only random psql restriction tokens when comparing schema dumps',()=>{
  expect(normalizeSchemaDump('\\restrict AbC123\nCREATE TABLE example();\n\\unrestrict AbC123')).toBe('CREATE TABLE example();');
  expect(normalizeSchemaDump('CREATE TABLE changed();')).not.toBe(normalizeSchemaDump('CREATE TABLE example();'));
  expect(normalizeSchemaDump('\\restrict token with spaces')).toBe('\\restrict token with spaces');
});

const configuration=()=>recoveryConfiguration({NODE_ENV:'test',TEST_DATABASE_URL:'postgresql://contentos:fixture@127.0.0.1:55487/contentos_test',RECOVERY_CONTAINER:'contentos-test-0123456789ab-db',RECOVERY_DOCKER:'/fixture/docker',RECOVERY_DOCKER_HOST:'unix:///fixture/docker.sock',RECOVERY_OWNER:'contentos-test-0123456789ab'});
const inspection=()=>({Name:'/contentos-test-0123456789ab-db',State:{Running:true},Config:{Image:'postgres:17-alpine',Labels:{'contentos.test.owner':'contentos-test-0123456789ab'}},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'55487'}]}}});
it('binds recovery to its running owned PostgreSQL container and exact loopback port',()=>{
  expect(()=>assertRecoveryOwnership(JSON.stringify([inspection()]),configuration())).not.toThrow();
  for(const mutate of [
    (value:ReturnType<typeof inspection>)=>{value.Name='/other';},
    (value:ReturnType<typeof inspection>)=>{value.State.Running=false;},
    (value:ReturnType<typeof inspection>)=>{value.Config.Image='other';},
    (value:ReturnType<typeof inspection>)=>{value.Config.Labels['contentos.test.owner']='other';},
    (value:ReturnType<typeof inspection>)=>{value.NetworkSettings.Ports['5432/tcp'][0]!.HostIp='0.0.0.0';},
    (value:ReturnType<typeof inspection>)=>{value.NetworkSettings.Ports['5432/tcp'][0]!.HostPort='5432';},
    (value:ReturnType<typeof inspection>)=>{value.NetworkSettings.Ports['5432/tcp'].push({HostIp:'127.0.0.1',HostPort:'55488'});},
  ]){const value=inspection();mutate(value);expect(()=>assertRecoveryOwnership(JSON.stringify([value]),configuration())).toThrow('Recovery ownership verification failed');}
  for(const raw of ['sentinel-inspect-secret','[]','null','{}'])expect(()=>assertRecoveryOwnership(raw,configuration())).toThrow('Recovery ownership verification failed');
});
it('removes inherited credentials, DB/PG settings, Docker overrides and Node preload hooks from children',()=>{
  expect(recoveryChildEnvironment({PATH:'/fixture/bin',HOME:'/fixture/home',TMPDIR:'/fixture/tmp',NODE_ENV:'production',NODE_OPTIONS:'sentinel-node-secret',DATABASE_URL:'sentinel-db-secret',PGPASSWORD:'sentinel-pg-secret',OPENAI_API_KEY:'sentinel-api-secret',DOCKER_HOST:'sentinel-host-secret',RECOVERY_OWNER:'sentinel-owner'})).toEqual({PATH:'/fixture/bin',HOME:'/fixture/home',TMPDIR:'/fixture/tmp',NODE_ENV:'test'});
});
it('emits fixed stage failure diagnostics rather than arbitrary messages',()=>{
  expect(recoveryFailure('dump_restore')).toBe('{"event":"database_recovery_failed","stage":"dump_restore"}');
  expect(recoveryFailure('sentinel-error-secret' as RecoveryStage)).not.toContain('sentinel');
});
