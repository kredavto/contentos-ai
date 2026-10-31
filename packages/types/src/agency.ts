import { z } from 'zod';
export const agencyModeSchema = z.object({ enabled: z.boolean(), revision: z.number().int().nonnegative() }).strict();
const timezone = z.string().max(80).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } });
export const agencyClientSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('CREATE'), name: z.string().trim().min(1).max(120), timezone, idempotencyKey: z.uuid() }).strict(),
  z.object({ kind: z.literal('LINK'), organizationId: z.uuid(), idempotencyKey: z.uuid() }).strict(),
]);
export type AgencyClientInput = z.infer<typeof agencyClientSchema>;
export const agencyClientStateSchema = z.object({ revision: z.uuid(), archived: z.boolean() }).strict();
