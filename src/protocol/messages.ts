import { z } from 'zod';
import { PageSnapshotSchema } from './page-snapshot';

export const SnapshotRequestSchema = z
  .object({
    type: z.literal('lens.page.snapshot.request'),
    requestId: z.string().min(1).max(128),
  })
  .strict();

export const SnapshotErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'NO_ACTIVE_TAB',
  'UNSUPPORTED_PAGE',
  'PAGE_ACCESS_DENIED',
  'INVALID_SNAPSHOT',
  'SNAPSHOT_FAILED',
]);

export const SnapshotSuccessSchema = z
  .object({
    type: z.literal('lens.page.snapshot.response'),
    requestId: z.string().min(1).max(128),
    ok: z.literal(true),
    snapshot: PageSnapshotSchema,
  })
  .strict();

export const SnapshotFailureSchema = z
  .object({
    type: z.literal('lens.page.snapshot.response'),
    requestId: z.string().min(1).max(128),
    ok: z.literal(false),
    error: z
      .object({
        code: SnapshotErrorCodeSchema,
        message: z.string().min(1),
        details: z.string().min(1).optional(),
      })
      .strict(),
  })
  .strict();

export const SnapshotResponseSchema = z.discriminatedUnion('ok', [
  SnapshotSuccessSchema,
  SnapshotFailureSchema,
]);

export const RuntimeRequestSchema = SnapshotRequestSchema;
export const RuntimeResponseSchema = SnapshotResponseSchema;

export type SnapshotRequest = z.infer<typeof SnapshotRequestSchema>;
export type SnapshotErrorCode = z.infer<typeof SnapshotErrorCodeSchema>;
export type SnapshotFailure = z.infer<typeof SnapshotFailureSchema>;
export type SnapshotResponse = z.infer<typeof SnapshotResponseSchema>;
export type RuntimeResponse = z.infer<typeof RuntimeResponseSchema>;
