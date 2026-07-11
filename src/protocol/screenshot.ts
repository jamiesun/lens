import { z } from 'zod';

export const ScreenshotModeSchema = z.enum(['viewport', 'full-page']);
export type ScreenshotMode = z.infer<typeof ScreenshotModeSchema>;

export const ScreenshotResultSchema = z
  .object({
    dataUrl: z.string().startsWith('data:image/').max(8_500_000),
    filename: z.string().min(1).max(160),
    mimeType: z.enum(['image/png', 'image/jpeg']),
    width: z.number().int().positive().max(32_768),
    height: z.number().int().positive().max(32_768),
    mode: ScreenshotModeSchema,
    truncated: z.boolean(),
  })
  .strict();

export type ScreenshotResult = z.infer<typeof ScreenshotResultSchema>;

export const ScreenshotRequestSchema = z
  .object({
    type: z.literal('lens.page.screenshot.request'),
    requestId: z.string().min(1).max(128),
    mode: ScreenshotModeSchema,
  })
  .strict();

export const ScreenshotResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      type: z.literal('lens.page.screenshot.response'),
      requestId: z.string().min(1).max(128),
      ok: z.literal(true),
      screenshot: ScreenshotResultSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('lens.page.screenshot.response'),
      requestId: z.string().min(1).max(128),
      ok: z.literal(false),
      error: z
        .object({
          code: z.enum([
            'INVALID_REQUEST',
            'NO_ACTIVE_TAB',
            'UNSUPPORTED_PAGE',
            'PAGE_ACCESS_DENIED',
            'CAPTURE_FAILED',
            'CAPTURE_TOO_LARGE',
            'PAGE_CHANGED',
          ]),
          message: z.string().min(1).max(500),
          details: z.string().min(1).max(500).optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type ScreenshotRequest = z.infer<typeof ScreenshotRequestSchema>;
export type ScreenshotResponse = z.infer<typeof ScreenshotResponseSchema>;
