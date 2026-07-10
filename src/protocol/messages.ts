import { z } from 'zod';
import { FillFieldValueSchema, FillResultSchema } from './page-commands';
import { PageSnapshotSchema } from './page-snapshot';

export const RuntimeErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'NO_ACTIVE_TAB',
  'UNSUPPORTED_PAGE',
  'PAGE_ACCESS_DENIED',
  'INVALID_SNAPSHOT',
  'SNAPSHOT_FAILED',
  'STALE_SNAPSHOT',
  'FILL_FAILED',
]);

const requestId = z.string().min(1).max(128);

const runtimeError = z
  .object({
    code: RuntimeErrorCodeSchema,
    message: z.string().min(1),
    details: z.string().min(1).optional(),
  })
  .strict();

export const SnapshotRequestSchema = z
  .object({
    type: z.literal('lens.page.snapshot.request'),
    requestId,
  })
  .strict();

export const FillRequestSchema = z
  .object({
    type: z.literal('lens.page.fill.request'),
    requestId,
    snapshotId: z.string().min(1).max(128),
    generation: z.number().int().positive(),
    fields: z.array(FillFieldValueSchema).min(1).max(40),
  })
  .strict();

export const RuntimeRequestSchema = z.discriminatedUnion('type', [
  SnapshotRequestSchema,
  FillRequestSchema,
]);

export const SnapshotResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      type: z.literal('lens.page.snapshot.response'),
      requestId,
      ok: z.literal(true),
      snapshot: PageSnapshotSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('lens.page.snapshot.response'),
      requestId,
      ok: z.literal(false),
      error: runtimeError,
    })
    .strict(),
]);

export const FillResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      type: z.literal('lens.page.fill.response'),
      requestId,
      ok: z.literal(true),
      result: FillResultSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('lens.page.fill.response'),
      requestId,
      ok: z.literal(false),
      error: runtimeError,
    })
    .strict(),
]);

export type RuntimeErrorCode = z.infer<typeof RuntimeErrorCodeSchema>;
export type SnapshotRequest = z.infer<typeof SnapshotRequestSchema>;
export type FillRequest = z.infer<typeof FillRequestSchema>;
export type RuntimeRequest = z.infer<typeof RuntimeRequestSchema>;
export type SnapshotResponse = z.infer<typeof SnapshotResponseSchema>;
export type FillResponse = z.infer<typeof FillResponseSchema>;
export type RuntimeResponse = SnapshotResponse | FillResponse;
