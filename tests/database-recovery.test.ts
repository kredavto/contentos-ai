import {expect,it} from 'vitest';
import {assertRecoveryMatch,normalizeSchemaDump,recoveryConfiguration,type RecoverySnapshot} from '../scripts/database-recovery-support';

it('requires the disposable local recovery environment before connecting',()=>{
  const valid={NODE_ENV:'test',TEST_DATABASE_URL:'postgresql://contentos:fixture@127.0.0.1:55487/contentos_test',RECOVERY_CONTAINER:'contentos-test-0123456789ab-db',RECOVERY_DOCKER:'/fixture/docker'};
  expect(recoveryConfiguration(valid).url.pathname).toBe('/contentos_test');
  for(const override of [{NODE_ENV:'production'},{RECOVERY_CONTAINER:'development-db'},{RECOVERY_DOCKER:''},{TEST_DATABASE_URL:'postgresql://contentos@remote.example:5432/contentos_test'},{TEST_DATABASE_URL:'postgresql://contentos@127.0.0.1:5432/production'},{TEST_DATABASE_URL:valid.TEST_DATABASE_URL+'?options=unsafe'},{TEST_DATABASE_URL:'invalid'}])expect(()=>recoveryConfiguration({...valid,...override})).toThrow('Disposable recovery environment required');
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
