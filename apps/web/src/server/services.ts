import { AuthService, BrandService, GenerationService } from '@contentos/core';
import { AuthRepository, BrandRepository, JobRepository, LedgerRepository, ContentRepository, createDatabase } from '@contentos/db';
import { parseServerEnvironment } from '@contentos/config';
import { SmtpEmailProvider, UnconfiguredEmailProvider } from '@contentos/providers';
import { DomainError } from '@contentos/types';
function createServices() {
  let env;
  try { env = parseServerEnvironment(process.env); } catch { throw new DomainError('CONFIGURATION_REQUIRED', 503); }
  const { db } = createDatabase(env.DATABASE_URL);
  const email = env.SMTP_URL && env.EMAIL_FROM ? new SmtpEmailProvider(env.SMTP_URL, env.EMAIL_FROM, env.NODE_ENV === 'production') : new UnconfiguredEmailProvider();
  const generation = new GenerationService(new JobRepository(db), new BrandRepository(db), new LedgerRepository(db), new ContentRepository(db), { provider: env.AI_PROVIDER, model: env.AI_PROVIDER === 'mock' ? 'mock-v1' : env.OPENAI_MODEL ?? '', ready: env.AI_PROVIDER === 'mock' || (env.AI_PROVIDER === 'openai' && !!env.OPENAI_API_KEY && !!env.OPENAI_MODEL) });
  return { env, generation, auth: new AuthService(new AuthRepository(db), email, env.APP_URL, env.APP_NAME), brands: new BrandService(new BrandRepository(db)) };
}
const globalServices = globalThis as typeof globalThis & { contentosServices?: ReturnType<typeof createServices> };
export function services() { return globalServices.contentosServices ??= createServices(); }
export const sessionCookie = 'contentos_session';
