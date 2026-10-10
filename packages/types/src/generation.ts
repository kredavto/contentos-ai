import { z } from 'zod';
import { brandBrainSchema } from './brand-brain';
import {strategySchema,platformSchema,funnelSchema,type StrategyOutput} from './strategy';
import {performanceEvidenceSchema,performanceOutputSchema,type PerformanceOutput} from './performance';
export {strategySchema,platformSchema,funnelSchema,type StrategyOutput} from './strategy';
const text = z.string().min(1).max(4000);
export const workflowTypes = ['GENERATE_STRATEGY', 'GENERATE_IDEAS', 'GENERATE_SCRIPT', 'OPTIMIZE_STRATEGY'] as const;
export type JobType = WorkflowType | 'CREATE_AVATAR' | 'GENERATE_VIDEO';
export type WorkflowType = (typeof workflowTypes)[number];
const score = z.number().min(0).max(100);
export const ideaSchema = z.object({
  title: text, angle: text, hook: text, audienceSegment: text, contentPillar: text,
  funnelStage: funnelSchema, platform: platformSchema, format: z.enum(['SHORT_VIDEO', 'POST', 'CAROUSEL', 'STORY', 'IMAGE']),
  scores: z.object({ relevance: score, novelty: score, brandFit: score, conversionPotential: score, viralityPotential: score }).strict(),
  rationale: text,
}).strict();
export const ideasSchema = z.object({ ideas: z.array(ideaSchema).min(1).max(20), caveat: text }).strict();
export const scriptSchema = z.object({ hook: text, context: text, core: text, proof: text, cta: text, factCheckNotes: z.array(text).max(20) }).strict();
export const generationOptionsSchema = z.object({
  platform: platformSchema.default('TELEGRAM'), duration: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(90)]).default(30),
  topic: z.string().max(2000).default(''), audience: z.string().max(1000).default(''), tone: z.string().max(1000).default(''),
  pillar: z.string().max(1000).default(''), product: z.string().max(1000).default(''), cta: z.string().max(1000).default(''), goal: z.string().max(1000).default(''),
  analysisDays:z.union([z.literal(7),z.literal(30),z.literal(90)]).optional(),
  ideaId: z.uuid().optional(), scriptId: z.uuid().optional(), revision: z.number().int().nonnegative().optional(),
  edit: z.enum(['GENERATE', 'REWRITE', 'SHORTEN', 'EXPAND', 'PROVOCATIVE', 'EXPERT', 'EMOTIONAL', 'SALES', 'CHANGE_CTA']).default('GENERATE'),
}).strict();
export const generationRequestSchema = z.object({ type: z.enum(workflowTypes), options: generationOptionsSchema.default(() => generationOptionsSchema.parse({})), idempotencyKey: z.uuid() }).strict();
export const generationInputSchema = z.object({ brain: brandBrainSchema, options: generationOptionsSchema, brandRevision: z.number().int().nonnegative(), previousScript: scriptSchema.optional(), performance:z.object({evidence:performanceEvidenceSchema,strategyId:z.uuid(),strategyVersion:z.number().int().positive(),strategy:strategySchema}).strict().optional() }).strict();
export type GenerationInput = z.infer<typeof generationInputSchema>;
export type GenerationOptions = z.infer<typeof generationOptionsSchema>;
export type IdeasOutput = z.infer<typeof ideasSchema>;
export type ScriptOutput = z.infer<typeof scriptSchema>;
export type GenerationOutput = StrategyOutput | IdeasOutput | ScriptOutput | PerformanceOutput;
export const workflowSchemas = { GENERATE_STRATEGY: strategySchema, GENERATE_IDEAS: ideasSchema, GENERATE_SCRIPT: scriptSchema, OPTIMIZE_STRATEGY:performanceOutputSchema };
export const jobStates = ['QUEUED', 'RUNNING', 'RETRY', 'SUCCEEDED', 'FAILED', 'WAITING_EXTERNAL', 'WAITING_REVIEW', 'RECONCILIATION'] as const;
export type JobState = (typeof jobStates)[number];
export type UsageUnit = 'AI_CREDITS' | 'VIDEO_SECONDS';
