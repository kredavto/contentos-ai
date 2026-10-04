import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { DomainError, maxPhotoUploadBytes, mediaUploadSchema } from '@contentos/types';
const messages: Record<string, string> = {
  NOT_AUTHORIZED: 'Нет доступа. Проверьте данные входа и вашу роль.', NOT_FOUND: 'Объект не найден.',
  INVALID_INPUT: 'Проверьте поля формы. Ссылка также могла истечь или уже использоваться.', CONFLICT: 'Данные изменились. Обновите страницу и повторите действие.',
  CONFIGURATION_REQUIRED: 'Сервис ещё не настроен. Администратор должен подключить необходимые службы.',
  RATE_LIMITED: 'Слишком много попыток. Попробуйте через 15 минут.', PROVIDER_UNAVAILABLE: 'Внешний сервис временно недоступен. Повторите позже.',
  INVALID_MEDIA: 'Выберите корректный файл JPEG, PNG или WebP размером до 3 МБ и до 16 мегапикселей.',
  RECONCILIATION_REQUIRED: 'Результат запроса пока не подтверждён. Не создавайте дубликат; требуется проверка задачи.',
  INSUFFICIENT_CREDITS: 'Недостаточно кредитов для этой операции.',
  CONSENT_REQUIRED: 'Для этой операции требуется действующее согласие.',
  PLAN_LIMIT_REACHED: 'Достигнут лимит хранилища. Удалите ненужные файлы.',
};
export async function readPhotoUpload(request: Request) {
  let name: string;
  try { name = decodeURIComponent(request.headers.get('x-file-name') ?? ''); } catch { throw new DomainError('INVALID_INPUT'); }
  const input = mediaUploadSchema.parse({name,mimeType:request.headers.get('content-type'),idempotencyKey:request.headers.get('idempotency-key')});
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxPhotoUploadBytes)) throw new DomainError('INVALID_MEDIA',413);
  const reader = request.body?.getReader(); if (!reader) throw new DomainError('INVALID_MEDIA');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const {done,value} = await reader.read(); if (done) break; size += value.byteLength; if (size > maxPhotoUploadBytes) throw new DomainError('INVALID_MEDIA',413); chunks.push(value); }
  } finally { await reader.cancel(); }
  if (!size) throw new DomainError('INVALID_MEDIA');
  return {input,bytes:new Uint8Array(Buffer.concat(chunks))};
}
export async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new DomainError('INVALID_INPUT', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError('INVALID_INPUT');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 128 * 1024) { await reader.cancel(); throw new DomainError('INVALID_INPUT', 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new DomainError('INVALID_INPUT'); }
}
export function assertOrigin(request: Request, appUrl: string) {
  if (request.headers.get('origin') !== new URL(appUrl).origin) throw new DomainError('NOT_AUTHORIZED', 403);
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new DomainError('NOT_AUTHORIZED', 403);
}
export function clientAddress(request: Request): string {
  // Only use a header that the trusted deployment edge overwrites, never arbitrary X-Forwarded-For.
  if (process.env.VERCEL === '1') return request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  // Shared conservative bucket until a trusted reverse proxy is configured.
  return 'local-or-unconfigured-proxy';
}
export async function apiResponse(action: (correlationId: string) => Promise<Response>) {
  const correlationId = randomUUID();
  const started = performance.now();
  try {
    const response = await action(correlationId);
    response.headers.set('X-Request-Id', correlationId);
    response.headers.set('Cache-Control', 'no-store');
    console.info(JSON.stringify({ event: 'api_request', correlationId, status: response.status, durationMs: Math.round(performance.now() - started) }));
    return response;
  } catch (error) {
    const code = error instanceof DomainError ? error.code : error instanceof ZodError ? 'INVALID_INPUT' : 'INTERNAL_ERROR';
    const status = error instanceof DomainError ? error.status : error instanceof ZodError ? 400 : 500;
    console.error(JSON.stringify({ event: 'api_error', correlationId, code, status, durationMs: Math.round(performance.now() - started) }));
    return Response.json({ error: { code, message: messages[code] ?? 'Не удалось выполнить действие. Попробуйте позже.', correlationId } }, { status, headers: { 'Cache-Control': 'no-store', 'X-Request-Id': correlationId, ...(status === 429 ? { 'Retry-After': '900' } : {}) } });
  }
}
