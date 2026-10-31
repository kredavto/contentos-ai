import {DomainError,type ErrorReporter} from '@contentos/types';
/** Reporting is best-effort and cannot prevent durable failure settlement. */
export function reportError(reporter:ErrorReporter|undefined,error:unknown,context:{correlationId:string;jobId?:string;code?:string}){
  try{reporter?.capture(error instanceof Error?error:new Error('INTERNAL_ERROR'),{...context,code:context.code??(error instanceof DomainError?error.code:'INTERNAL_ERROR')});}catch{/* A reporter failure is not a job failure. */}
}
