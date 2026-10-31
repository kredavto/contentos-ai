import type {Instrumentation} from 'next';
export const onRequestError:Instrumentation.onRequestError=async error=>{
  if(process.env.NEXT_RUNTIME!=='nodejs')return;
  const {errorReporter}=await import('./server/error-reporting');
  const correlationId=crypto.randomUUID(),code='INTERNAL_ERROR';
  console.error(JSON.stringify({event:'server_render_error',correlationId,code}));
  const reporter=errorReporter();reporter.capture(error instanceof Error?error:new Error(code),{correlationId,code});await reporter.flush?.(1000);
};
