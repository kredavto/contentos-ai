import {S3Client,CreateBucketCommand} from '@aws-sdk/client-s3';
export async function prepareBenchmarkBucket(){
  if(process.env.NODE_ENV!=='test'||process.env.CONTENTOS_BENCHMARK!=='synthetic-only')throw new Error('Fixture only');
  const client=new S3Client({endpoint:'http://127.0.0.1:9000',region:'us-east-1',forcePathStyle:true,credentials:{accessKeyId:'fixture-access',secretAccessKey:'fixture-secret-not-production'}});
  try{await client.send(new CreateBucketCommand({Bucket:'contentos-benchmark'}));}finally{client.destroy();}
}
