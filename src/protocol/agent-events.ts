import { z } from 'zod';

export const AgentRunRequestSchema = z
  .object({
    type: z.literal('lens.agent.run'),
    goal: z.string().min(1).max(2_000),
    history: z
      .array(
        z
          .object({
            role: z.enum(['user', 'assistant']),
            content: z.string().min(1).max(4_000),
          })
          .strict(),
      )
      .max(12)
      .default([]),
  })
  .strict();

export const AgentCancelRequestSchema = z
  .object({
    type: z.literal('lens.agent.cancel'),
  })
  .strict();

export const AgentPortRequestSchema = z.discriminatedUnion('type', [
  AgentRunRequestSchema,
  AgentCancelRequestSchema,
]);

export const AgentEventSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('status'),
      text: z.string().min(1).max(300),
    })
    .strict(),
  z
    .object({
      kind: z.literal('tool'),
      tool: z.enum(['page.snapshot', 'page.form.fill']),
      status: z.enum(['started', 'completed', 'failed']),
      detail: z.string().max(300),
      affected: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('assistant'),
      text: z.string().min(1).max(8_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal('done'),
    })
    .strict(),
  z
    .object({
      kind: z.literal('error'),
      code: z.enum([
        'VAULT_LOCKED',
        'NOT_CONFIGURED',
        'MODEL_ERROR',
        'TOOL_ERROR',
        'STEP_LIMIT',
        'CANCELLED',
        'AGENT_FAILED',
      ]),
      message: z.string().min(1).max(500),
    })
    .strict(),
]);

export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;
export type AgentHistoryItem = AgentRunRequest['history'][number];
export type AgentPortRequest = z.infer<typeof AgentPortRequestSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const AGENT_PORT_NAME = 'lens-agent';
