import { z } from 'zod';
import { ScreenshotResultSchema } from './screenshot';

export const MAX_AGENT_ATTACHMENT_COUNT = 4;
export const MAX_AGENT_ATTACHMENT_BYTES = 32 * 1_024;

export const AgentAttachmentSchema = z
  .object({
    name: z.string().min(1).max(180),
    mimeType: z.string().min(1).max(100),
    size: z.number().int().min(1).max(MAX_AGENT_ATTACHMENT_BYTES),
    content: z.string().min(1).max(MAX_AGENT_ATTACHMENT_BYTES),
  })
  .strict();

export const AgentRunRequestSchema = z
  .object({
    type: z.literal('lens.agent.run'),
    goal: z.string().min(1).max(2_000),
    attachments: z
      .array(AgentAttachmentSchema)
      .max(MAX_AGENT_ATTACHMENT_COUNT)
      .default([]),
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
      tool: z.enum([
        'page.snapshot',
        'page.form.fill',
        'page.click',
        'page.screenshot',
      ]),
      status: z.enum(['started', 'completed', 'failed']),
      detail: z.string().max(300),
      affected: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('screenshot'),
      screenshot: ScreenshotResultSchema,
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
export type AgentAttachment = z.infer<typeof AgentAttachmentSchema>;
export type AgentHistoryItem = AgentRunRequest['history'][number];
export type AgentPortRequest = z.infer<typeof AgentPortRequestSchema>;
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const AGENT_PORT_NAME = 'lens-agent';
