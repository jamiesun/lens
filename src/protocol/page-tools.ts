import { z } from 'zod';
import { ToolRiskSchema, type ToolRisk } from './page-snapshot';

/**
 * Lens Page Tools v1 — the private page protocol.
 *
 * A cooperating page exposes structured tools by publishing a registry on
 * `window.__lensPageToolsV1` in its own (MAIN world) JavaScript context:
 *
 * ```js
 * window.__lensPageToolsV1 = {
 *   version: 1,
 *   sessionId: crypto.randomUUID(),
 *   tools: new Map(), // name -> { name, description, risk, inputSchema?, execute }
 * };
 * ```
 *
 * The runtime discovers tools with `scripting.executeScript({ world: 'MAIN' })`,
 * validates every declaration, and only then offers them to the model under a
 * `site_` prefix. Everything a page declares is untrusted input: risk labels
 * can only restrict, never widen, what the runtime allows.
 */

export const PAGE_TOOLS_PROTOCOL_VERSION = 1;
export const PAGE_TOOLS_GLOBAL_KEY = '__lensPageToolsV1';
export const SITE_TOOL_PREFIX = 'site_';

export const MAX_PAGE_TOOLS = 16;
export const MAX_PAGE_TOOL_DESCRIPTION_CHARS = 500;
export const MAX_PAGE_TOOL_SCHEMA_CHARS = 4_096;
export const MAX_PAGE_TOOL_ARGUMENT_CHARS = 8_192;
export const MAX_PAGE_TOOL_RESULT_CHARS = 32_768;
export const PAGE_TOOL_CALL_TIMEOUT_MS = 10_000;

/**
 * Risks the runtime executes without a confirmation policy. Every other
 * declared risk (server-write, destructive, financial) is registered as
 * blocked until confirmations exist, no matter what the page claims.
 */
export const PAGE_TOOLS_ALLOWED_RISKS: ReadonlySet<ToolRisk> = new Set([
  'observe',
  'local-write',
]);

export const PageToolNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,63}$/,
    'Tool names must be lowercase snake_case (max 64 chars).',
  );

/**
 * One tool as it crosses the MAIN-world boundary. The reader serializes
 * `inputSchema` to JSON text in the page so a hostile object graph cannot
 * break the structured clone of the whole registry.
 */
export const PageToolWireDescriptorSchema = z
  .object({
    name: PageToolNameSchema,
    description: z.string().min(1).max(MAX_PAGE_TOOL_DESCRIPTION_CHARS),
    risk: ToolRiskSchema,
    inputSchemaJson: z.string().max(MAX_PAGE_TOOL_SCHEMA_CHARS).optional(),
  })
  .strict();

/**
 * The raw registry envelope returned by the MAIN-world reader. Tools stay
 * loosely typed here so a future protocol version is reported as
 * "incompatible" instead of failing generic validation.
 */
export const PageToolsWireEnvelopeSchema = z.discriminatedUnion('present', [
  z.object({ present: z.literal(false) }).strict(),
  z
    .object({
      present: z.literal(true),
      version: z.number().int().min(0).max(1_000_000),
      sessionId: z.string().min(1).max(128),
      tools: z.array(z.unknown()).max(64),
    })
    .strict(),
]);

export const PageToolCallErrorCodeSchema = z.enum([
  'NO_REGISTRY',
  'STALE_TOOLS',
  'TOOL_NOT_FOUND',
  'INVALID_ARGUMENTS',
  'EXECUTE_ERROR',
  'TIMEOUT',
  'RESULT_NOT_JSON',
  'RESULT_TOO_LARGE',
]);

export const PageToolCallWireResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      resultJson: z.string().max(MAX_PAGE_TOOL_RESULT_CHARS),
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: PageToolCallErrorCodeSchema,
      message: z.string().min(1).max(300),
    })
    .strict(),
]);

export interface ValidatedPageTool {
  name: string;
  description: string;
  risk: ToolRisk;
  inputSchema?: Record<string, unknown>;
}

export type PageToolWireDescriptor = z.infer<
  typeof PageToolWireDescriptorSchema
>;
export type PageToolsWireEnvelope = z.infer<typeof PageToolsWireEnvelopeSchema>;
export type PageToolCallErrorCode = z.infer<typeof PageToolCallErrorCodeSchema>;
export type PageToolCallWireResult = z.infer<
  typeof PageToolCallWireResultSchema
>;
