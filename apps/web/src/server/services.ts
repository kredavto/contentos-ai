import { AnalyticsService, PublishingService, SocialService, credentialVaultFromEnvironment, CalendarService, AuthService, BrandService, GenerationService, ConsentService, MediaService, AvatarService, VoiceService, VideoService } from '@contentos/core';
import { AnalyticsRepository, PublishingRepository, SocialRepository, CalendarRepository, AuthRepository, BrandRepository, JobRepository, LedgerRepository, ContentRepository, ConsentRepository, MediaRepository, AvatarRepository, VoiceRepository, VideoRepository, createDatabase } from '@contentos/db';
import { parseServerEnvironment } from '@contentos/config';
import { SmtpEmailProvider, UnconfiguredEmailProvider, storageFromEnvironment, avatarFromEnvironment, voiceCatalogFromEnvironment, videoFromEnvironment, captionsFromEnvironment, socialFromEnvironment, publishingFromEnvironment } from '@contentos/providers';
import { DomainError } from '@contentos/types';
function createServices() {
  let env;
  try { env = parseServerEnvironment(process.env); } catch { throw new DomainError('CONFIGURATION_REQUIRED', 503); }
  const { db } = createDatabase(env.DATABASE_URL);
  const email = env.SMTP_URL && env.EMAIL_FROM ? new SmtpEmailProvider(env.SMTP_URL, env.EMAIL_FROM, env.NODE_ENV === 'production') : new UnconfiguredEmailProvider();
  const generation = new GenerationService(new JobRepository(db), new BrandRepository(db), new LedgerRepository(db), new ContentRepository(db), { provider: env.AI_PROVIDER, model: env.AI_PROVIDER === 'mock' ? 'mock-v1' : env.OPENAI_MODEL ?? '', ready: env.AI_PROVIDER === 'mock' || (env.AI_PROVIDER === 'openai' && !!env.OPENAI_API_KEY && !!env.OPENAI_MODEL) });
  const storage = storageFromEnvironment(env);
  return { env, generation, analytics:new AnalyticsService(new AnalyticsRepository(db)), publishing:new PublishingService(new PublishingRepository(db),publishingFromEnvironment(env),!!credentialVaultFromEnvironment(env)), social:new SocialService(new SocialRepository(db),socialFromEnvironment(env),credentialVaultFromEnvironment(env)), calendar:new CalendarService(new CalendarRepository(db)), videos:new VideoService(new VideoRepository(db),videoFromEnvironment(env),storage,env.VIDEO_GENERATION_ENABLED==='true',captionsFromEnvironment(env)), voices:new VoiceService(new VoiceRepository(db),voiceCatalogFromEnvironment(env)), avatars: new AvatarService(new AvatarRepository(db), avatarFromEnvironment(env), storage, env.AVATAR_GENERATION_ENABLED==='true'), media: new MediaService(new MediaRepository(db), storage), consent: new ConsentService(new ConsentRepository(db)), auth: new AuthService(new AuthRepository(db), email, env.APP_URL, env.APP_NAME), brands: new BrandService(new BrandRepository(db)) };
}
const globalServices = globalThis as typeof globalThis & { contentosServices?: ReturnType<typeof createServices> };
export function services() { return globalServices.contentosServices ??= createServices(); }
export const sessionCookie = 'contentos_session';
