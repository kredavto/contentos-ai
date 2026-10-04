import { z } from 'zod';
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(1).max(80).default('CONTENTOS AI'),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.url(),
  SMTP_URL: z.url().optional(),
  EMAIL_FROM: z.email().optional(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && !env.APP_URL.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'Production origin must use HTTPS' });
});
export function parseServerEnvironment(source: Record<string, string | undefined>) { return serverSchema.parse(source); }
export function publicProductConfig(source: Record<string, string | undefined>) {
  return { name: z.string().min(1).max(80).default('CONTENTOS AI').parse(source.APP_NAME) };
}
