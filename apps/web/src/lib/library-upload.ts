import {apiUrl} from './api-url';
import {z} from 'zod';

const resultSchema=z.object({data:z.object({id:z.uuid(),status:z.enum(['UPLOADING','QUEUED','RUNNING','READY','FAILED','DELETE_PENDING','DELETED'])})});
const errorSchema=z.object({error:z.object({message:z.string()})});

/** Only a same-origin application route receives browser file bytes. */
export function sendLibrarySource(path:string,file:Blob,mimeType:string,signal:AbortSignal,onProgress:(percent:number)=>void){
  return new Promise<z.infer<typeof resultSchema>['data']>((resolve,reject)=>{
    const request=new XMLHttpRequest();
    const abort=()=>request.abort();
    const cleanup=()=>signal.removeEventListener('abort',abort);
    request.open('POST',apiUrl(path));request.timeout=90_000;
    request.setRequestHeader('Content-Type',mimeType);
    request.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.min(100,Math.round(event.loaded/event.total*100)));};
    request.onerror=request.ontimeout=()=>{cleanup();reject(new Error('Связь прервалась. Повторите загрузку: повторный запрос не создаст дубликат.'));};
    request.onabort=()=>{cleanup();reject(new Error('Передача прервана. Вы можете повторить загрузку.'));};
    request.onload=()=>{
      cleanup();let body:unknown;
      try{body=JSON.parse(request.responseText);}catch{reject(new Error('Не удалось подтвердить загрузку. Повторите запрос.'));return;}
      if(request.status<200||request.status>=300){reject(new Error(errorSchema.safeParse(body).data?.error.message??'Не удалось загрузить файл. Повторите запрос.'));return;}
      const parsed=resultSchema.safeParse(body);
      if(!parsed.success){reject(new Error('Не удалось подтвердить загрузку. Повторите запрос.'));return;}
      resolve(parsed.data.data);
    };
    if(signal.aborted){reject(new Error('Передача прервана.'));return;}
    signal.addEventListener('abort',abort,{once:true});request.send(file);
  });
}
