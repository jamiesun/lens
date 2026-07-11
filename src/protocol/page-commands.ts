import { z } from 'zod';

export const FillFieldValueSchema = z
  .object({
    nodeId: z.string().min(1).max(128),
    value: z.string().max(4_000),
  })
  .strict();

export const FillRejectReasonSchema = z.enum([
  'not-found',
  'detached',
  'hidden',
  'sensitive',
  'disabled',
  'readonly',
  'unsupported-type',
]);

export const FieldFillOutcomeSchema = z.discriminatedUnion('status', [
  z
    .object({
      nodeId: z.string().min(1).max(128),
      status: z.literal('filled'),
    })
    .strict(),
  z
    .object({
      nodeId: z.string().min(1).max(128),
      status: z.literal('rejected'),
      reason: FillRejectReasonSchema,
    })
    .strict(),
]);

export const FillResultSchema = z
  .object({
    snapshotId: z.string().min(1),
    generation: z.number().int().positive(),
    outcomes: z.array(FieldFillOutcomeSchema).min(1).max(40),
  })
  .strict();

export const ClickRejectReasonSchema = z.enum([
  'not-found',
  'detached',
  'hidden',
  'disabled',
  'submit-blocked',
  'risk-blocked',
  'unsupported-type',
]);

export const ClickOutcomeSchema = z.discriminatedUnion('status', [
  z
    .object({
      nodeId: z.string().min(1).max(128),
      status: z.literal('clicked'),
    })
    .strict(),
  z
    .object({
      nodeId: z.string().min(1).max(128),
      status: z.literal('rejected'),
      reason: ClickRejectReasonSchema,
    })
    .strict(),
]);

export const ClickResultSchema = z
  .object({
    snapshotId: z.string().min(1),
    generation: z.number().int().positive(),
    outcome: ClickOutcomeSchema,
  })
  .strict();

const snapshotCommand = z
  .object({
    source: z.literal('lens-background'),
    command: z.literal('page.snapshot'),
  })
  .strict();

const documentIdentityCommand = z
  .object({
    source: z.literal('lens-background'),
    command: z.literal('page.document.identity'),
  })
  .strict();

const fillCommand = z
  .object({
    source: z.literal('lens-background'),
    command: z.literal('page.form.fill'),
    payload: z
      .object({
        snapshotId: z.string().min(1).max(128),
        generation: z.number().int().positive(),
        fields: z.array(FillFieldValueSchema).min(1).max(40),
      })
      .strict(),
  })
  .strict();

const clickCommand = z
  .object({
    source: z.literal('lens-background'),
    command: z.literal('page.click'),
    payload: z
      .object({
        snapshotId: z.string().min(1).max(128),
        generation: z.number().int().positive(),
        nodeId: z.string().min(1).max(128),
      })
      .strict(),
  })
  .strict();

const screenshotPrepareCommand = z
  .object({
    source: z.literal('lens-background'),
    command: z.literal('page.screenshot.prepare'),
    payload: z
      .object({
        sessionId: z.string().min(1).max(128),
      })
      .strict(),
  })
  .strict();

const screenshotScrollCommand = z
  .object({
    source: z.literal('lens-background'),
    command: z.literal('page.screenshot.scroll'),
    payload: z
      .object({
        sessionId: z.string().min(1).max(128),
        y: z.number().int().nonnegative().max(100_000),
        hideFixed: z.boolean(),
      })
      .strict(),
  })
  .strict();

const screenshotRestoreCommand = z
  .object({
    source: z.literal('lens-background'),
    command: z.literal('page.screenshot.restore'),
    payload: z
      .object({
        sessionId: z.string().min(1).max(128),
      })
      .strict(),
  })
  .strict();

export const PageCommandSchema = z.discriminatedUnion('command', [
  snapshotCommand,
  documentIdentityCommand,
  fillCommand,
  clickCommand,
  screenshotPrepareCommand,
  screenshotScrollCommand,
  screenshotRestoreCommand,
]);

export const DocumentIdentityResultSchema = z
  .object({
    documentId: z.string().min(1).max(128),
  })
  .strict();

export const FillCommandResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      result: FillResultSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.literal('STALE_SNAPSHOT'),
      message: z.string().min(1),
    })
    .strict(),
]);

export const ScreenshotPrepareResultSchema = z
  .object({
    ok: z.literal(true),
    sessionId: z.string().min(1).max(128),
    documentWidth: z.number().int().positive().max(10_000_000),
    documentHeight: z.number().int().positive().max(10_000_000),
    viewportWidth: z.number().int().positive().max(20_000),
    viewportHeight: z.number().int().positive().max(20_000),
  })
  .strict();

export const ScreenshotScrollResultSchema = z
  .object({
    ok: z.literal(true),
    scrollY: z.number().int().nonnegative().max(100_000),
  })
  .strict();

export const ScreenshotRestoreResultSchema = z
  .object({
    ok: z.literal(true),
  })
  .strict();

export const ClickCommandResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      ok: z.literal(true),
      result: ClickResultSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      code: z.literal('STALE_SNAPSHOT'),
      message: z.string().min(1),
    })
    .strict(),
]);

export type FillFieldValue = z.infer<typeof FillFieldValueSchema>;
export type FillRejectReason = z.infer<typeof FillRejectReasonSchema>;
export type FieldFillOutcome = z.infer<typeof FieldFillOutcomeSchema>;
export type FillResult = z.infer<typeof FillResultSchema>;
export type ClickRejectReason = z.infer<typeof ClickRejectReasonSchema>;
export type ClickOutcome = z.infer<typeof ClickOutcomeSchema>;
export type ClickResult = z.infer<typeof ClickResultSchema>;
export type PageCommand = z.infer<typeof PageCommandSchema>;
export type FillCommandResult = z.infer<typeof FillCommandResultSchema>;
export type ClickCommandResult = z.infer<typeof ClickCommandResultSchema>;
