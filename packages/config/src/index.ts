import { z } from 'zod';
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(1).max(80).default('CONTENTOS AI'),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.url(),
  AI_PROVIDER: z.enum(['disabled', 'openai', 'mock']).default('disabled'),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  STORAGE_PROVIDER: z.enum(['disabled', 's3']).default('disabled'),
  S3_REGION: z.string().min(1).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('false'),
  S3_ENCRYPTION: z.enum(['AES256', 'aws:kms']).optional(),
  S3_KMS_KEY_ID: z.string().min(1).optional(),
  SMTP_URL: z.url().optional(),
  EMAIL_FROM: z.email().optional(),
}).superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && env.AI_PROVIDER === 'mock') ctx.addIssue({ code: 'custom', path: ['AI_PROVIDER'], message: 'Mock AI is forbidden in production' });
  if (env.NODE_ENV === 'production' && !env.APP_URL.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'Production origin must use HTTPS' });
});
export function parseServerEnvironment(source: Record<string, string | undefined>) { return serverSchema.parse(source); }
export function publicProductConfig(source: Record<string, string | undefined>) {
  return { name: z.string().min(1).max(80).default('CONTENTOS AI').parse(source.APP_NAME) };
}
