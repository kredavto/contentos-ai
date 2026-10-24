import {youtubeThreadPageSchema,youtubeReplyPageSchema,normalizedYouTubeComment} from './youtube-comments';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {DomainError,ProviderRequestError,youtubeCommentsScope,youtubeCommentIdSchema,youtubeCommentCursorSchema,type YouTubeCommentsProvider,type YouTubeCommentPublishingProvider,type YouTubeCommentReplyInput,youtubeCommentReplyInputSchema,normalizedMetricsSchema,type YouTubeStatisticsProvider,oauthTokenSchema,youtubeChannelIdSchema,youtubeVideoIdSchema,youtubeMetadataSchema,youtubeTokensSchema,type YouTubeAuthorizationProvider,type YouTubePublishingProvider,type YouTubeMetadata,type YouTubeTokens,type YouTubeVideo,type YouTubeUploadResult,type OperationContext,type ErrorCode} from '@contentos/types';

export const youtubeScopes=['https://www.googleapis.com/auth/youtube.upload','https://www.googleapis.com/auth/youtube.readonly'] as const;
const api='https://www.googleapis.com/youtube/v3';
const tokenUrl='https://oauth2.googleapis.com/token';
const verifierSchema=z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);
const sizeSchema=z.number().int().positive().max(256_000_000_000);
const failureCode=z.string().regex(/^[A-Za-z0-9_]{1,100}$/);
const videoSchema=z.object({id:youtubeVideoIdSchema,snippet:z.object({channelId:youtubeChannelIdSchema}),status:z.object({uploadStatus:z.enum(['deleted','failed','processed','rejected','uploaded']),privacyStatus:z.enum(['private','public','unlisted']),failureReason:failureCode.optional(),rejectionReason:failureCode.optional()}),processingDetails:z.object({processingStatus:z.enum(['failed','processing','succeeded','terminated']),processingFailureReason:failureCode.optional()}).optional()});
const tokenResponseSchema=z.object({access_token:oauthTokenSchema,token_type:z.literal('Bearer'),expires_in:z.number().int().min(1).max(86400),refresh_token:oauthTokenSchema.optional(),refresh_token_expires_in:z.number().int().positive().max(315360000).optional(),scope:z.string().min(1).max(8192).optional()});
const commentReceiptSchema=z.object({id:youtubeCommentIdSchema,snippet:z.object({channelId:youtubeChannelIdSchema,parentId:youtubeCommentIdSchema,authorChannelId:z.object({value:youtubeChannelIdSchema}),textOriginal:z.string().max(2000),publishedAt:z.iso.datetime({offset:true})})});
const googleErrorSchema=z.object({error:z.object({code:z.number().int(),errors:z.array(z.object({reason:failureCode})).optional()})});
const oauthErrorSchema=z.object({error:z.enum(['invalid_grant','invalid_client','access_denied','invalid_request','unauthorized_client','unsupported_grant_type','invalid_scope'])});

function input<T>(schema:z.ZodType<T>,value:unknown):T{const parsed=schema.safeParse(value);if(!parsed.success)throw new DomainError('INVALID_INPUT');return parsed.data;}
export function youtubeSessionUrl(value:string){
  try{
    const url=new URL(value);
    if(value.length>8192||url.origin!=='https://www.googleapis.com'||url.pathname!=='/upload/youtube/v3/videos'||url.username||url.password||url.hash||url.searchParams.getAll('uploadType').length!==1||url.searchParams.get('uploadType')!=='resumable'||url.searchParams.getAll('upload_id').length!==1||!url.searchParams.get('upload_id')||url.searchParams.has('access_token'))throw new Error('Invalid session');
    return url.href;
  }catch{throw new DomainError('INVALID_INPUT');}
}
function retryAfter(value:string|null){
  if(value===null)return null;
  const seconds=/^\d+$/.test(value)?Number(value):Math.ceil((Date.parse(value)-Date.now())/1000);
  return Number.isFinite(seconds)?Math.max(1,Math.min(86400,seconds)):null;
}
export class YouTubeRequestError extends ProviderRequestError{
  constructor(code:ErrorCode,status:number,definitive:boolean,readonly retryAfterSeconds:number|null=null){super(code,status,definitive);}
}
function invalidResponse(mutation:boolean){return new YouTubeRequestError(mutation?'RECONCILIATION_REQUIRED':'PROVIDER_REJECTED',mutation?409:502,false);}
async function json(response:Response,mutation:boolean,maxBytes=256000):Promise<unknown>{
  try{
    const reader=response.body?.getReader();if(!reader)throw invalidResponse(mutation);
    const chunks:Uint8Array[]=[];let length=0;
    try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>maxBytes)throw invalidResponse(mutation);chunks.push(next.value);}}
    finally{await reader.cancel();}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }catch{throw invalidResponse(mutation);}
}
async function decode<T>(schema:z.ZodType<T>,response:Response,mutation=false,maxBytes=256000):Promise<T>{const parsed=schema.safeParse(await json(response,mutation,maxBytes));if(!parsed.success)throw invalidResponse(mutation);return parsed.data;}

/** Official Google endpoints only; no retry, redirects, credential logging or implicit publish. */
export class YouTubeProvider implements YouTubeAuthorizationProvider,YouTubePublishingProvider,YouTubeStatisticsProvider,YouTubeCommentsProvider,YouTubeCommentPublishingProvider{
  private readonly redirectUri:string;
  constructor(private readonly options:{clientId:string;clientSecret:string;redirectUri:string},private readonly transport:typeof fetch=fetch){
    try{
      input(z.string().regex(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/),options.clientId);input(oauthTokenSchema,options.clientSecret);
      const url=new URL(options.redirectUri);
      if(url.username||url.password||url.search||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('Invalid callback');
      this.redirectUri=url.href;
    }catch{throw new DomainError('CONFIGURATION_REQUIRED',503);}
  }
  authorizationUrl(state:string,verifier:string,commentsAccess=false){
    input(z.boolean(),commentsAccess);
    input(z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),state);input(verifierSchema,verifier);
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search=new URLSearchParams({client_id:this.options.clientId,redirect_uri:this.redirectUri,response_type:'code',scope:[...youtubeScopes,...(commentsAccess?[youtubeCommentsScope]:[])].join(' '),state,access_type:'offline',prompt:'consent',include_granted_scopes:'true',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();return url.href;
  }
  private async request(url:string,init:RequestInit,context:OperationContext,operation:string,mutation=false,accepted=[200]){
    let status=0;const started=Date.now();
    try{
      const response=await this.transport(url,{...init,redirect:'manual',signal:AbortSignal.any([context.signal,AbortSignal.timeout(operation==='upload'?60000:15000)])});status=response.status;
      if(accepted.includes(status))return response;
      const body=await json(response,mutation),oauth=oauthErrorSchema.safeParse(body),error=googleErrorSchema.safeParse(body);
      const definitive=(error.success&&error.data.error.code===status&&[400,401,403,404,409,429].includes(status))||(url===tokenUrl&&oauth.success&&[400,401,403].includes(status));
      if(!definitive)throw invalidResponse(mutation);
      const reasons=error.success?error.data.error.errors?.map(row=>row.reason)??[]:[];
      if(operation==='comment_insert'){
        // Only documented non-creation errors are definitive for this non-idempotent write.
        const rejected:Record<number,readonly string[]>={400:['commentTextRequired','commentTextTooLong','invalidCustomEmoji','invalidCommentMetadata','operationNotSupported','parentCommentIsPrivate','parentIdMissing'],401:['authError'],403:['forbidden','ineligibleAccount','insufficientPermissions','commentsDisabled','quotaExceeded','rateLimitExceeded','userRateLimitExceeded'],404:['parentCommentNotFound'],429:['rateLimitExceeded','userRateLimitExceeded']};
        if(!reasons.length||reasons.some(reason=>!rejected[status]?.includes(reason)))throw invalidResponse(true);
      }
      const code:ErrorCode=operation.startsWith('comment_')&&reasons.includes('commentsDisabled')?'COMMENTS_DISABLED':operation.startsWith('comment_')&&status===404?'NOT_FOUND':oauth.success&&['invalid_client','unauthorized_client'].includes(oauth.data.error)?'CONFIGURATION_REQUIRED':status===401||(oauth.success&&oauth.data.error==='invalid_grant')?'SOCIAL_TOKEN_EXPIRED':status===429||reasons.some(reason=>['quotaExceeded','rateLimitExceeded','userRateLimitExceeded','uploadLimitExceeded'].includes(reason))?'RATE_LIMITED':status===403?'NOT_AUTHORIZED':'PROVIDER_REJECTED';
      throw new YouTubeRequestError(code,code==='RATE_LIMITED'?429:code==='CONFIGURATION_REQUIRED'?503:409,true,retryAfter(response.headers.get('retry-after')));
    }catch(error){if(error instanceof DomainError)throw error;throw new YouTubeRequestError(mutation?'RECONCILIATION_REQUIRED':'PROVIDER_UNAVAILABLE',mutation?409:503,false);}
    finally{console.log(JSON.stringify({event:'provider_request',provider:'youtube',operation,requestId:context.correlationId,jobId:context.internalId,status,durationMs:Date.now()-started}));}
  }
  private headers(accessToken:string){return {Authorization:`Bearer ${input(oauthTokenSchema,accessToken)}`};}
  private async tokens(body:URLSearchParams,context:OperationContext,previous?:YouTubeTokens){
    const response=await this.request(tokenUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body},context,previous?'refresh':'exchange',true);
    const value=await decode(tokenResponseSchema,response,true),scopes=value.scope?.split(/\s+/).filter(Boolean)??previous?.scopes;
    if(!scopes||!youtubeScopes.every(scope=>scopes.includes(scope))||(!value.refresh_token&&!previous))throw new DomainError('NOT_AUTHORIZED',403);
    const now=Date.now();
    const parsed=youtubeTokensSchema.safeParse({accessToken:value.access_token,refreshToken:value.refresh_token??previous!.refreshToken,expiresAt:new Date(now+value.expires_in*1000).toISOString(),refreshExpiresAt:value.refresh_token_expires_in?new Date(now+value.refresh_token_expires_in*1000).toISOString():previous?.refreshExpiresAt??null,scopes});
    if(!parsed.success)throw invalidResponse(true);return parsed.data;
  }
  exchange(code:string,verifier:string,context:OperationContext){
    input(oauthTokenSchema,code);input(verifierSchema,verifier);
    return this.tokens(new URLSearchParams({client_id:this.options.clientId,client_secret:this.options.clientSecret,redirect_uri:this.redirectUri,grant_type:'authorization_code',code,code_verifier:verifier}),context);
  }
  refresh(tokens:YouTubeTokens,context:OperationContext){
    const checked=input(youtubeTokensSchema,tokens);
    if(checked.refreshExpiresAt&&Date.parse(checked.refreshExpiresAt)<=Date.now())throw new DomainError('SOCIAL_TOKEN_EXPIRED',409);
    return this.tokens(new URLSearchParams({client_id:this.options.clientId,client_secret:this.options.clientSecret,grant_type:'refresh_token',refresh_token:checked.refreshToken}),context,checked);
  }
  async revoke(refreshToken:string,context:OperationContext){
    const response=await this.request('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:input(oauthTokenSchema,refreshToken)})},context,'revoke',true);
    await response.body?.cancel();
  }
  async channel(accessToken:string,context:OperationContext){
    const response=await this.request(`${api}/channels?part=snippet&mine=true&maxResults=50`,{headers:this.headers(accessToken)},context,'channel');
    const value=await decode(z.object({nextPageToken:z.string().optional(),items:z.array(z.object({id:youtubeChannelIdSchema,snippet:z.object({title:z.string().min(1).max(256),customUrl:z.string().max(256).optional()})})).max(50)}),response);
    // Uploads target the channel bound to the grant. Never guess among multiple channels.
    if(value.items.length!==1||value.nextPageToken)throw new DomainError('NOT_AUTHORIZED',403);
    const channel=value.items[0]!;return {reference:{provider:'youtube',internalId:context.internalId,externalId:channel.id,metadata:{}},name:channel.snippet.title,username:channel.snippet.customUrl??null};
  }
  async categories(accessToken:string,regionCode:string,context:OperationContext){
    input(z.string().regex(/^[A-Z]{2}$/),regionCode);
    const response=await this.request(`${api}/videoCategories?part=snippet&regionCode=${regionCode}`,{headers:this.headers(accessToken)},context,'categories');
    const result=await decode(z.object({items:z.array(z.object({id:youtubeMetadataSchema.shape.categoryId,snippet:z.object({title:z.string().min(1).max(256),assignable:z.boolean()})})).max(100)}),response);
    return result.items.filter(item=>item.snippet.assignable).map(item=>({id:item.id,title:item.snippet.title}));
  }
  async startUpload(accessToken:string,metadata:YouTubeMetadata,totalBytes:number,context:OperationContext){
    const value=input(youtubeMetadataSchema,metadata);input(sizeSchema,totalBytes);
    const body={snippet:{title:value.title,description:value.description,tags:value.tags,categoryId:value.categoryId},status:{privacyStatus:value.privacy.toLowerCase(),selfDeclaredMadeForKids:value.madeForKids,containsSyntheticMedia:value.containsSyntheticMedia}};
    const response=await this.request('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',{method:'POST',headers:{...this.headers(accessToken),'Content-Type':'application/json; charset=UTF-8','X-Upload-Content-Length':String(totalBytes),'X-Upload-Content-Type':'video/mp4'},body:JSON.stringify(body)},context,'start_upload',true);
    await response.body?.cancel();
    try{return youtubeSessionUrl(response.headers.get('location')??'');}catch{throw invalidResponse(true);}
  }
  private videoResult(value:z.infer<typeof videoSchema>,channelId:string,context:OperationContext):YouTubeVideo{
    if(value.snippet.channelId!==channelId)throw invalidResponse(true);
    const failed=['deleted','failed','rejected'].includes(value.status.uploadStatus)||['failed','terminated'].includes(value.processingDetails?.processingStatus??'');
    return {reference:{provider:'youtube',internalId:context.internalId,externalId:value.id,metadata:{channelId}},channelId,privacy:value.status.privacyStatus.toUpperCase() as YouTubeVideo['privacy'],state:failed?'FAILED':value.status.uploadStatus==='processed'&&(!value.processingDetails||value.processingDetails.processingStatus==='succeeded')?'READY':'PROCESSING',failureCode:value.status.failureReason??value.status.rejectionReason??value.processingDetails?.processingFailureReason??(failed?value.status.uploadStatus:null)};
  }
  private async uploadResult(response:Response,totalBytes:number,channelId:string,context:OperationContext):Promise<YouTubeUploadResult>{
    if(response.status===404||response.status===410){await response.body?.cancel();return {state:'EXPIRED'};}
    if(response.status===308){
      await response.body?.cancel();const range=response.headers.get('range');
      if(range===null)return {state:'UPLOADING',nextByte:0,retryAfterSeconds:retryAfter(response.headers.get('retry-after'))};
      const match=/^bytes=0-(\d+)$/.exec(range),nextByte=match?Number(match[1])+1:NaN;
      if(!Number.isSafeInteger(nextByte)||nextByte<1||nextByte>totalBytes)throw invalidResponse(true);
      return {state:'UPLOADING',nextByte,retryAfterSeconds:retryAfter(response.headers.get('retry-after'))};
    }
    return {state:'COMPLETE',video:this.videoResult(await decode(videoSchema,response,true),channelId,context)};
  }
  async probeUpload(accessToken:string,session:string,totalBytes:number,channelId:string,context:OperationContext){
    input(sizeSchema,totalBytes);input(youtubeChannelIdSchema,channelId);
    const response=await this.request(youtubeSessionUrl(session),{method:'PUT',headers:{...this.headers(accessToken),'Content-Length':'0','Content-Range':`bytes */${totalBytes}`}},context,'probe_upload',false,[200,201,308,404,410]);
    return this.uploadResult(response,totalBytes,channelId,context);
  }
  async upload(accessToken:string,session:string,value:{totalBytes:number;offset:number;bytes:Uint8Array;channelId:string},context:OperationContext){
    input(sizeSchema,value.totalBytes);input(z.number().int().nonnegative(),value.offset);input(youtubeChannelIdSchema,value.channelId);
    const end=value.offset+value.bytes.length;
    if(!value.bytes.length||value.bytes.length>64*1024*1024||end>value.totalBytes||(end<value.totalBytes&&value.bytes.length%262144!==0))throw new DomainError('INVALID_MEDIA');
    const response=await this.request(youtubeSessionUrl(session),{method:'PUT',headers:{...this.headers(accessToken),'Content-Type':'video/mp4','Content-Length':String(value.bytes.length),'Content-Range':`bytes ${value.offset}-${end-1}/${value.totalBytes}`},body:Uint8Array.from(value.bytes)},context,'upload',true,[200,201,308,404,410]);
    return this.uploadResult(response,value.totalBytes,value.channelId,context);
  }
  async video(accessToken:string,videoId:string,channelId:string,context:OperationContext){
    input(youtubeVideoIdSchema,videoId);input(youtubeChannelIdSchema,channelId);
    const response=await this.request(`${api}/videos?part=snippet,status,processingDetails&id=${videoId}`,{headers:this.headers(accessToken)},context,'video');
    const result=await decode(z.object({items:z.array(videoSchema).max(1)}),response);
    if(!result.items.length)return null;if(result.items[0]!.id!==videoId)throw invalidResponse(false);
    return this.videoResult(result.items[0]!,channelId,context);
  }
  async statistics(accessToken:string,videoId:string,channelId:string,context:OperationContext){
    input(youtubeVideoIdSchema,videoId);input(youtubeChannelIdSchema,channelId);context.signal.throwIfAborted();
    const response=await this.request(`${api}/videos?part=snippet,statistics&id=${videoId}&fields=items(id,snippet(channelId),statistics(viewCount,likeCount,commentCount))`,{headers:this.headers(accessToken)},context,'statistics');
    const count=z.string().max(13).regex(/^(0|[1-9][0-9]*)$/).transform(Number).refine(value=>Number.isSafeInteger(value)&&value<=1_000_000_000_000);
    const body=await decode(z.object({items:z.array(z.object({id:youtubeVideoIdSchema,snippet:z.object({channelId:youtubeChannelIdSchema}),statistics:z.object({viewCount:count.optional(),likeCount:count.optional(),commentCount:count.optional()}).optional()})).max(1)}),response);
    const row=body.items[0];if(!row)return null;
    if(row.id!==videoId||row.snippet.channelId!==channelId)throw new DomainError('NOT_AUTHORIZED',403);
    return {reference:{provider:'youtube',internalId:context.internalId,externalId:row.id,metadata:{kind:'video-statistics'}},observedAt:new Date().toISOString(),metrics:normalizedMetricsSchema.parse({views:row.statistics?.viewCount??null,likes:row.statistics?.likeCount??null,comments:row.statistics?.commentCount??null})};
  }
  async commentThreads(accessToken:string,videoId:string,channelId:string,cursor:string|null,context:OperationContext){
    input(youtubeVideoIdSchema,videoId);input(youtubeChannelIdSchema,channelId);if(cursor!==null)input(youtubeCommentCursorSchema,cursor);
    // Verify the channel even when the comment page is empty.
    const target=await decode(z.object({items:z.array(z.object({id:youtubeVideoIdSchema,snippet:z.object({channelId:youtubeChannelIdSchema})})).max(1)}),await this.request(`${api}/videos?part=snippet&id=${videoId}`,{headers:this.headers(accessToken)},context,'comment_target'));
    if(!target.items.length)throw new DomainError('NOT_FOUND',404);
    if(target.items[0]!.id!==videoId||target.items[0]!.snippet.channelId!==channelId)throw invalidResponse(false);
    const query=new URLSearchParams({part:'snippet',videoId,maxResults:'20',order:'time',textFormat:'plainText',moderationStatus:'published',...(cursor?{pageToken:cursor}:{})});
    const page=await decode(youtubeThreadPageSchema,await this.request(`${api}/commentThreads?${query}`,{headers:this.headers(accessToken)},context,'comment_threads'),false,1048576);
    if((cursor!==null&&page.nextPageToken===cursor)||new Set(page.items.map(row=>row.id)).size!==page.items.length||new Set(page.items.map(row=>row.snippet.topLevelComment.id)).size!==page.items.length)throw invalidResponse(false);
    for(const row of page.items)if(row.snippet.channelId!==channelId||row.snippet.videoId!==videoId||row.snippet.topLevelComment.snippet.channelId!==channelId||row.snippet.topLevelComment.snippet.parentId!==undefined)throw invalidResponse(false);
    return {reference:{provider:'youtube',internalId:context.internalId,externalId:videoId,metadata:{kind:'comment-threads',channelId}},observedAt:new Date().toISOString(),nextCursor:page.nextPageToken??null,items:page.items.map(row=>({externalId:row.id,comment:normalizedYouTubeComment(row.snippet.topLevelComment),replyCount:row.snippet.totalReplyCount,canReply:row.snippet.canReply,isPublic:row.snippet.isPublic}))};
  }
  async commentReplies(accessToken:string,parentId:string,channelId:string,cursor:string|null,context:OperationContext){
    input(youtubeCommentIdSchema,parentId);input(youtubeChannelIdSchema,channelId);if(cursor!==null)input(youtubeCommentCursorSchema,cursor);
    const query=new URLSearchParams({part:'snippet',parentId,maxResults:'20',textFormat:'plainText',...(cursor?{pageToken:cursor}:{})});
    const page=await decode(youtubeReplyPageSchema,await this.request(`${api}/comments?${query}`,{headers:this.headers(accessToken)},context,'comment_replies'),false,1048576);
    if((cursor!==null&&page.nextPageToken===cursor)||new Set(page.items.map(row=>row.id)).size!==page.items.length)throw invalidResponse(false);
    for(const row of page.items)if(row.snippet.channelId!==channelId||row.snippet.parentId!==parentId||row.id===parentId)throw invalidResponse(false);
    return {reference:{provider:'youtube',internalId:context.internalId,externalId:parentId,metadata:{kind:'comment-replies',channelId}},observedAt:new Date().toISOString(),nextCursor:page.nextPageToken??null,items:page.items.map(normalizedYouTubeComment)};
  }
  async commentReplyReceipt(accessToken:string,externalId:string,raw:YouTubeCommentReplyInput,context:OperationContext){
    const value=input(youtubeCommentReplyInputSchema,raw);input(youtubeCommentIdSchema,externalId);input(z.uuid(),context.internalId);
    const query=new URLSearchParams({part:'snippet',id:externalId,textFormat:'plainText'});
    const page=await decode(z.object({items:z.array(commentReceiptSchema).max(1)}),await this.request(`${api}/comments?${query}`,{headers:this.headers(accessToken)},context,'comment_receipt'));
    const receipt=page.items[0];if(!receipt)return null;
    if(receipt.id!==externalId||receipt.id===value.parentId||receipt.snippet.channelId!==value.channelId||receipt.snippet.authorChannelId.value!==value.channelId||receipt.snippet.parentId!==value.parentId||receipt.snippet.textOriginal!==value.text)throw invalidResponse(false);
    return {reference:{provider:'youtube',internalId:context.internalId,externalId:receipt.id,metadata:{kind:'comment-reply',parentId:value.parentId,channelId:value.channelId}},publishedAt:new Date(receipt.snippet.publishedAt).toISOString()};
  }
  async insertCommentReply(accessToken:string,raw:YouTubeCommentReplyInput,context:OperationContext){
    const value=input(youtubeCommentReplyInputSchema,raw);input(z.uuid(),context.internalId);
    const headers={...this.headers(accessToken),'Content-Type':'application/json; charset=UTF-8'};
    if(context.signal.aborted)throw new YouTubeRequestError('PROVIDER_UNAVAILABLE',503,true);
    // A stable local intent does not make YouTube comments.insert idempotent. Never retry here.
    const response=await this.request(`${api}/comments?part=snippet`,{method:'POST',headers,body:JSON.stringify({snippet:{parentId:value.parentId,textOriginal:value.text}})},context,'comment_insert',true,[200,201]);
    const receipt=await decode(commentReceiptSchema,response,true);
    if(receipt.id===value.parentId||receipt.snippet.channelId!==value.channelId||receipt.snippet.authorChannelId.value!==value.channelId||receipt.snippet.parentId!==value.parentId||receipt.snippet.textOriginal!==value.text)throw invalidResponse(true);
    return {reference:{provider:'youtube',internalId:context.internalId,externalId:receipt.id,metadata:{kind:'comment-reply',parentId:value.parentId,channelId:value.channelId}},publishedAt:new Date(receipt.snippet.publishedAt).toISOString()};
  }
  async thumbnail(accessToken:string,videoId:string,value:{bytes:Uint8Array;mimeType:'image/png'|'image/jpeg'},context:OperationContext){
    input(youtubeVideoIdSchema,videoId);input(z.enum(['image/png','image/jpeg']),value.mimeType);
    const png=value.bytes.length>=8&&Buffer.from(value.bytes.subarray(0,8)).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpeg=value.bytes[0]===255&&value.bytes[1]===216&&value.bytes[2]===255;
    if(!value.bytes.length||value.bytes.length>50_000_000||(value.mimeType==='image/png'?!png:!jpeg))throw new DomainError('INVALID_MEDIA');
    const response=await this.request(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}&uploadType=media`,{method:'POST',headers:{...this.headers(accessToken),'Content-Type':value.mimeType},body:Uint8Array.from(value.bytes)},context,'thumbnail',true);
    await decode(z.object({items:z.array(z.object({default:z.object({url:z.url()}).optional(),medium:z.object({url:z.url()}).optional(),high:z.object({url:z.url()}).optional()}).refine(item=>!!item.default||!!item.medium||!!item.high)).min(1).max(1)}),response,true);
  }
}

export function youtubeFromEnvironment(env:{YOUTUBE_ENABLED:string;YOUTUBE_CLIENT_ID?:string;YOUTUBE_CLIENT_SECRET?:string;APP_URL:string}){
  if(env.YOUTUBE_ENABLED!=='true'||!env.YOUTUBE_CLIENT_ID||!env.YOUTUBE_CLIENT_SECRET)return null;
  try{return new YouTubeProvider({clientId:env.YOUTUBE_CLIENT_ID,clientSecret:env.YOUTUBE_CLIENT_SECRET,redirectUri:new URL('/api/social/youtube/callback',env.APP_URL).href});}
  catch{return null;}
}
