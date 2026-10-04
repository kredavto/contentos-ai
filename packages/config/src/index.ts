import { z } from 'zod';
const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_NAME: z.string().min(1).max(80).default('CONTENTOS AI'),
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.url(),
  PAYMENT_RENEWALS_ENABLED: z.enum(['true','false']).default('false'),
  PAYMENTS_ENABLED: z.enum(['true', 'false']).default('false'),
  PAYMENT_PROVIDER: z.enum(['disabled', 'yookassa']).default('disabled'),
  YOOKASSA_SHOP_ID: z.string().regex(/^\d{1,32}$/).optional(),
  YOOKASSA_SECRET_KEY: z.string().min(1).max(512).optional(),
  PAYMENT_RECEIPT_VAT_CODE: z.string().regex(/^(?:[1-9]|1[0-2])$/).optional(),
  PAYMENT_RECEIPT_TAX_SYSTEM_CODE: z.string().regex(/^[1-6]$/).optional(),
  PAYMENT_RECEIPT_SUBJECT: z.enum(['service', 'intellectual_activity']).optional(),
  YOOKASSA_TEST_MODE: z.enum(['true', 'false']).optional(),
  AI_PROVIDER: z.enum(['disabled', 'openai', 'mock']).default('disabled'),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).optional(),
  AVATAR_PROVIDER: z.enum(['disabled', 'heygen', 'mock']).default('disabled'),
  AVATAR_GENERATION_ENABLED: z.enum(['true', 'false']).default('false'),
  ANALYTICS_AI_ENABLED:z.enum(['true','false']).default('false'),
  ANALYTICS_ENABLED:z.enum(['true','false']).default('false'),
  PUBLISHING_ENABLED:z.enum(['true','false']).default('false'),
  SOCIAL_PROVIDER:z.enum(['disabled','telegram','mock']).default('disabled'),
  CREDENTIAL_ENCRYPTION_KEYS:z.string().min(1).max(4096).optional(),
  CREDENTIAL_ACTIVE_KEY_ID:z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/).optional(),
  CAPTION_PROVIDER: z.enum(['disabled','openai','mock']).default('disabled'),
  CAPTION_MODEL: z.literal('whisper-1').default('whisper-1'),
  VIDEO_PROVIDER: z.enum(['disabled','heygen','mock']).default('disabled'),
  VIDEO_GENERATION_ENABLED: z.enum(['true','false']).default('false'),
  FFMPEG_PATH: z.string().min(1).optional(),
  FFPROBE_PATH: z.string().min(1).optional(),
  MOCK_VIDEO_FILE: z.string().min(1).optional(),
  HEYGEN_API_KEY: z.string().min(1).optional(),
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
  if (env.NODE_ENV === 'production' && env.PAYMENTS_ENABLED === 'true' && env.YOOKASSA_TEST_MODE === 'true') ctx.addIssue({ code: 'custom', path: ['YOOKASSA_TEST_MODE'], message: 'Test payments are forbidden in production' });
  if(env.NODE_ENV==='production'&&env.SOCIAL_PROVIDER==='mock')ctx.addIssue({code:'custom',path:['SOCIAL_PROVIDER'],message:'Mock social connections are forbidden in production'});
  if(env.NODE_ENV==='production'&&env.CAPTION_PROVIDER==='mock')ctx.addIssue({code:'custom',path:['CAPTION_PROVIDER'],message:'Mock captions are forbidden in production'});
  if (env.NODE_ENV === 'production' && env.VIDEO_PROVIDER === 'mock') ctx.addIssue({code:'custom',path:['VIDEO_PROVIDER'],message:'Mock video is forbidden in production'});
  if (env.NODE_ENV === 'production' && env.AVATAR_PROVIDER === 'mock') ctx.addIssue({ code: 'custom', path: ['AVATAR_PROVIDER'], message: 'Mock avatars are forbidden in production' });
  if (env.NODE_ENV === 'production' && env.AI_PROVIDER === 'mock') ctx.addIssue({ code: 'custom', path: ['AI_PROVIDER'], message: 'Mock AI is forbidden in production' });
  if (env.NODE_ENV === 'production' && !env.APP_URL.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'Production origin must use HTTPS' });
});
export function parseServerEnvironment(source: Record<string, string | undefined>) { return serverSchema.parse(source); }
export function publicProductConfig(source: Record<string, string | undefined>) {
  return { name: z.string().min(1).max(80).default('CONTENTOS AI').parse(source.APP_NAME) };
}
