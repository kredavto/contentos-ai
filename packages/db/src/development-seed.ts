import { eq, sql } from 'drizzle-orm';
import { emptyOnboarding, generationInputSchema, scriptSchema, strategySchema } from '@contentos/types';
import type { Database } from './index';
import * as s from './schema';
import { reserveInTransaction, settleInTransaction } from './repositories/ledger';

export const demoEmail = 'demo@contentos.example.test';
const id = (n: number) => `de000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const demoIds = { user: id(1), tenant: id(2), workspace: id(3), brand: id(4), strategy: id(5), job: id(6), content: id(8), script: id(9) };
const marker = 'DEVELOPMENT_SEED_V1';

/** Validate before opening a connection. This command is deliberately not a production seeder. */
export function validateSeedEnvironment(env: Record<string, string | undefined>) {
  if (!['development', 'test'].includes(env.NODE_ENV ?? '') || env.CONTENTOS_DEMO_SEED !== 'true') throw new Error('Explicit development/test seed opt-in required');
  let url: URL;
  try { url = new URL(env.DATABASE_URL ?? ''); } catch { throw new Error('Local seed database required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.search || url.hash || !/^\/(contentos|[a-z0-9_]+_test)$/.test(url.pathname)) throw new Error('Local contentos or dedicated test database required');
  const password = env.CONTENTOS_DEMO_PASSWORD ?? '';
  if (password.length < 12 || password.length > 128) throw new Error('CONTENTOS_DEMO_PASSWORD must contain 12–128 characters');
  return { url: url.href, password };
}

/** Atomic insert-only fixture. A rerun never resets passwords, edits or grants. */
export async function seedDevelopment(db: Database, passwordHash: string) {
  if (!/^scrypt:v1:[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash)) throw new Error('Valid password hash required');
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(739214510)`);
    const [existing] = await tx.select({ id: s.auditLogs.id }).from(s.auditLogs).where(eq(s.auditLogs.action, marker)).limit(1);
    if (existing) return { created: false, email: demoEmail, ...demoIds };
    // Conflicts intentionally fail the whole transaction; never adopt an existing account.
    const { user, tenant, workspace, brand, strategy, job, content, script } = demoIds;
    const now = new Date();
    await tx.insert(s.users).values({ id: user, email: demoEmail, name: '[ДЕМО] Разработчик', passwordHash, emailVerifiedAt: now });
    await tx.insert(s.organizations).values({ id: tenant, name: '[ДЕМО] Учебная мастерская' });
    await tx.insert(s.organizationMembers).values({ tenantId: tenant, userId: user, role: 'OWNER' });
    await tx.insert(s.workspaces).values({ id: workspace, tenantId: tenant, name: '[ДЕМО] Рабочее пространство' });
    await tx.insert(s.brands).values({ id: brand, tenantId: tenant, workspaceId: workspace, name: '[ДЕМО] Бумажный сад', onboardingStep: 14, onboardingCompletedAt: now });
    const scope = { tenantId: tenant, brandId: brand };
    const brain = { ...emptyOnboarding('[ДЕМО] Бумажный сад'), website: 'https://example.test', niche: 'Учебные мастер-классы по оригами', geography: 'Вымышленный онлайн-проект', usp: 'Понятные шаги для начинающих', voice: 'Спокойно, понятно, без обещаний результата', products: [{ name: 'Основы оригами', description: 'Вымышленный учебный курс' }], audience: [{ name: 'Начинающие', description: 'Хотят освоить бумажные модели' }], pains: [{ name: 'Сложные схемы', description: 'Не хватает пошаговых объяснений' }], goals: ['Объяснять базовые приёмы'], platforms: ['TELEGRAM' as const], ctas: [{ name: 'Посмотреть учебный план', description: 'Демонстрационный CTA' }] };
    await tx.insert(s.brandProfiles).values({ ...scope, website: brain.website, niche: brain.niche, geography: brain.geography, usp: brain.usp, goals: brain.goals, socialPlatforms: brain.platforms });
    for (const [table, entries] of [[s.products, brain.products], [s.audienceSegments, brain.audience], [s.painPoints, brain.pains], [s.ctas, brain.ctas]] as const) await tx.insert(table).values(entries.map(entry => ({ ...scope, ...entry })));
    await tx.insert(s.brandVoice).values({ ...scope, name: 'Основной голос бренда', description: brain.voice });
    await tx.insert(s.contentPillars).values({ ...scope, name: 'Основы', description: 'Простые приёмы работы с бумагой' });
    const strategyContent = strategySchema.parse({ positioning: '[ДЕМО] Мастерская для начинающих', audienceSegments: ['Начинающие'], pains: ['Сложные схемы'], desires: ['Освоить простую модель'], objections: ['Нет опыта'], contentPillars: [{ name: 'Основы', purpose: 'Объяснять первые шаги' }], toneOfVoice: brain.voice, formats: ['POST'], frequency: 'Демонстрационный план; публикации не запланированы', funnelStages: ['AWARENESS'], ctas: ['Посмотреть учебный план'], leadMagnets: ['Демонстрационная памятка'], hypotheses: ['Пошаговые объяснения могут быть полезны; гипотеза не проверена'], recommendedChannels: ['TELEGRAM'], plan: Array.from({ length: 30 }, (_, i) => ({ day: i + 1, topic: `[ДЕМО] Приём ${i + 1}`, platform: 'TELEGRAM', format: 'POST', funnelStage: 'AWARENESS', cta: 'Посмотреть учебный план' })) });
    await tx.insert(s.strategies).values({ id: strategy, ...scope });
    await tx.insert(s.strategyVersions).values({ tenantId: tenant, strategyId: strategy, createdBy: user, version: 1, content: strategyContent });
    // Synthetic generation evidence is labeled mock, with a consistent immutable ledger.
    await tx.insert(s.usageLedger).values({ tenantId: tenant, unit: 'AI_CREDITS', type: 'GRANT', amount: 100, availableDelta: 100, reservedDelta: 0, idempotencyKey: 'development-seed:grant', correlationId: job });
    const reservation = await reserveInTransaction(tx, tenant, 'AI_CREDITS', 1, 'development-seed:ideas', job);
    await settleInTransaction(tx, tenant, reservation.id, 'CAPTURE', job);
    await tx.insert(s.jobs).values({ id: job, ...scope, requestedBy: user, type: 'GENERATE_IDEAS', status: 'SUCCEEDED', input: generationInputSchema.parse({ brain, options: {}, brandRevision: 0 }), inputHash: 'development-seed-v1', idempotencyKey: job, reservationId: reservation.id, provider: 'mock', model: 'development-seed-v1', progress: 100, correlationId: job, startedAt: now, finishedAt: now });
    for (let i = 0; i < 3; i++) await tx.insert(s.ideas).values({ ...scope, jobId: job, ordinal: i, title: `[ДЕМО] Первый шаг: модель ${i + 1}`, angle: 'Пошаговое объяснение', hook: 'С чего начать?', audienceLabel: 'Начинающие', pillarLabel: 'Основы', funnelStage: 'AWARENESS', platform: 'TELEGRAM', format: 'POST', score: 50, scores: { relevance: 50, novelty: 50, brandFit: 50, conversionPotential: 50, viralityPotential: 50 }, rationale: 'Синтетические оценки для интерфейса, не прогноз', source: 'DEVELOPMENT_SEED' });
    await tx.insert(s.contentItems).values({ id: content, ...scope, title: '[ДЕМО] Выбираем бумагу', type: 'POST', status: 'SCRIPT' });
    await tx.insert(s.scripts).values({ id: script, ...scope, contentItemId: content, currentVersion: 1, platform: 'TELEGRAM', duration: 30 });
    await tx.insert(s.scriptVersions).values({ tenantId: tenant, scriptId: script, createdBy: user, version: 1, content: scriptSchema.parse({ hook: '[ДЕМО] С чего начать оригами?', context: 'Выберите простую учебную модель.', core: 'Подготовьте квадратный лист и ровную поверхность.', proof: 'Добавьте собственный проверенный пример перед публикацией.', cta: 'Посмотреть учебный план', factCheckNotes: ['Демонстрационный материал; требуется редакторская проверка.'] }) });
    await tx.insert(s.auditLogs).values({ tenantId: tenant, userId: user, action: marker, resourceId: brand, correlationId: job, metadata: { fixture: true } });
    return { created: true, email: demoEmail, ...demoIds };
  });
}
