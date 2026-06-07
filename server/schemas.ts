import { z } from 'zod';
import { isSafeId } from './safeId';

const safeIdSchema = z.string().refine(isSafeId, { message: 'Invalid id' });
const localIdSchema = z.string().min(1).max(200);
const MAX_FLOW_NODES = 500;
const MAX_FLOW_EDGES = 1000;

const nodeSchema = z.object({
  id: localIdSchema,
  type: z.string().min(1),
  settings: z.record(z.unknown()).default({})
});

const edgeSchema = z.object({
  id: localIdSchema,
  source: localIdSchema,
  target: localIdSchema,
  sourcePortId: localIdSchema,
  targetPortId: localIdSchema
});

const positionSchema = z.object({ x: z.number(), y: z.number() });

const scheduleSchema = z.object({
  enabled: z.boolean(),
  intervalMs: z.number().int().positive().optional(),
  paused: z.boolean().optional(),
  nextRunAt: z.string().nullable().optional()
});

const flowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  failFast: z.boolean().optional(),
  nodes: z.array(nodeSchema).max(MAX_FLOW_NODES).default([]),
  edges: z.array(edgeSchema).max(MAX_FLOW_EDGES).default([]),
  nodePositions: z.record(positionSchema).default({}),
  blockSettings: z.record(z.record(z.unknown())).default({}),
  schedule: scheduleSchema.default({ enabled: false }),
  createdAt: z.string().optional()
});

const flowPutBodySchema = z.object({ flow: flowSchema });

const runPostBodySchema = z.object({ flowId: safeIdSchema });

export type FlowPutBody = z.infer<typeof flowPutBodySchema>;
export type RunPostBody = z.infer<typeof runPostBodySchema>;

export function parseFlowPutBody(body: unknown): z.SafeParseReturnType<unknown, FlowPutBody> {
  return flowPutBodySchema.safeParse(body);
}

export function parseRunPostBody(body: unknown): z.SafeParseReturnType<unknown, RunPostBody> {
  return runPostBodySchema.safeParse(body);
}

/** Compact, secret-free message summarizing why a body failed validation. */
export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
}
