export interface OperationContext {
  internalId: string;
  tenantId: string;
  idempotencyKey: string;
  correlationId: string;
  signal: AbortSignal;
}
export interface ProviderReference {
  provider: string;
  externalId: string;
  internalId: string;
  metadata: Record<string, unknown>;
}
export interface Usage {
  model: string;
  inputUnits: number;
  outputUnits: number;
  costMicrounits: number | null;
  currency: string;
}
export interface LLMProvider {
  readonly name: string;
  generate(input: { system: string; prompt: string; jsonSchema: Record<string, unknown>; model: string }, context: OperationContext): Promise<{ json: unknown; usage: Usage }>;
}
export interface ImageProvider {
  generate(input: { prompt: string; width: number; height: number }, context: OperationContext): Promise<{ reference: ProviderReference; bytes: Uint8Array; mimeType: string; usage: Usage }>;
}
export interface AvatarProvider {
  create(input: { photoUrl: string; name: string; groupReference?: ProviderReference }, context: OperationContext): Promise<ProviderReference>;
  list(context: OperationContext): Promise<Array<{ reference: ProviderReference; name: string; previewUrl: string | null }>>;
  status(reference: ProviderReference, context: OperationContext): Promise<{ status: 'PROCESSING' | 'READY' | 'FAILED'; previewUrl: string | null }>;
  delete(reference: ProviderReference, context: OperationContext): Promise<void>;
}
export interface VoiceProvider {
  synthesize(input: { text: string; voice: ProviderReference }, context: OperationContext): Promise<{ bytes: Uint8Array; mimeType: string; durationSeconds: number }>;
}
export interface VoiceCatalogProvider {
  listPublicVoicePage(cursor:string|undefined,context:OperationContext):Promise<{voices:Array<{reference:ProviderReference;name:string;language:string|null;previewUrl:string|null}>;nextCursor:string|null}>;
}
export interface VideoProvider {
  delete(reference:ProviderReference,context:OperationContext):Promise<void>;
  download(url:string,context:OperationContext):Promise<Uint8Array>;
  submit(input: { script: string; avatar: ProviderReference; voice: ProviderReference; width: number; height: number }, context: OperationContext): Promise<ProviderReference>;
  status(reference: ProviderReference, context: OperationContext): Promise<{ status: 'PROCESSING' | 'READY' | 'FAILED'; downloadUrl?: string; errorCode?: string }>;
}
export interface CaptionSegment { start: number; end: number; text: string }
export interface VideoProcessingProvider {
  prepareAudio(bytes:Uint8Array,context:OperationContext):Promise<{bytes:Uint8Array;durationSeconds:number}>;
  process(input:{bytes:Uint8Array;options:import('./video-processing').VideoProcessingOptions;onStage?:(stage:'CAPTIONS_GENERATING'|'BROLL_PROCESSING'|'COVER_GENERATING'|'QC',details:Record<string,unknown>)=>Promise<void>},context:OperationContext):Promise<{bytes:Uint8Array;thumbnail:Uint8Array;durationSeconds:number;width:number;height:number}>;
}
export interface CaptionProvider {
  transcribe(input: { bytes: Uint8Array; mimeType: string; language: string }, context: OperationContext): Promise<CaptionSegment[]>;
}
export interface TrendProvider {
  discover(input: { query: string; locale: string }, context: OperationContext): Promise<Array<{ title: string; sourceUrl: string; observedAt: string; evidence: string }>>;
}
export interface PublishingProvider {
  publish(input: { credential: string; mediaUrl: string; caption: string; privacy: string }, context: OperationContext): Promise<{ reference: ProviderReference; status: 'PENDING' | 'PUBLISHED'; url?: string }>;
  status(reference: ProviderReference, credential: string, context: OperationContext): Promise<'PENDING' | 'PUBLISHED' | 'FAILED'>;
}
export type MetricName = 'views' | 'impressions' | 'reach' | 'likes' | 'comments' | 'shares' | 'saves' | 'watch_time' | 'average_watch_time' | 'completion_rate' | 'clicks' | 'followers_delta';
export interface AnalyticsProvider {
  fetch(reference: ProviderReference, credential: string, context: OperationContext): Promise<{ metrics: Partial<Record<MetricName, number | null>>; observedAt: string; raw: unknown }>;
}
export interface PaymentProvider {
  create(input: { amountMinor: number; currency: string; description: string; returnUrl: string; saveMethod: boolean }, context: OperationContext): Promise<{ reference: ProviderReference; confirmationUrl: string }>;
  get(reference: ProviderReference, context: OperationContext): Promise<{ status: 'PENDING' | 'SUCCEEDED' | 'CANCELED'; amountMinor: number; currency: string; paymentMethodId?: string }>;
  refund(reference: ProviderReference, amountMinor: number, context: OperationContext): Promise<ProviderReference>;
}
export interface StorageProvider {
  get(key:string,maxBytes:number,context:OperationContext):Promise<Uint8Array>;
  put(key: string, bytes: Uint8Array, mimeType: string, context: OperationContext): Promise<void>;
  signedDownload(key: string, expiresSeconds: number, context: OperationContext): Promise<string>;
  delete(key: string, context: OperationContext): Promise<void>;
}
export interface EmailProvider {
  send(input: { recipient: string; subject: string; text: string }, context: OperationContext): Promise<ProviderReference>;
}
export interface ErrorReporter {
  capture(error: Error, context: { correlationId: string; code: string; jobId?: string }): void;
}
