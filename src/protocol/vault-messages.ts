import { z } from 'zod';
import { ProviderConfigSchema } from './provider';

const requestId = z.string().min(1).max(128);

export const VaultRequestSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('lens.vault.status.request'),
      requestId,
    })
    .strict(),
  z
    .object({
      type: z.literal('lens.vault.configure.request'),
      requestId,
      provider: ProviderConfigSchema,
      apiKey: z.string().min(1).max(2_000),
      password: z.string().min(8).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal('lens.vault.unlock.request'),
      requestId,
      password: z.string().min(8).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal('lens.vault.lock.request'),
      requestId,
    })
    .strict(),
  z
    .object({
      type: z.literal('lens.vault.clear.request'),
      requestId,
    })
    .strict(),
]);

const VaultStateSchema = z
  .object({
    status: z.enum(['unconfigured', 'locked', 'unlocked']),
    provider: ProviderConfigSchema.optional(),
  })
  .strict();

export const VaultResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      type: z.literal('lens.vault.response'),
      requestId,
      ok: z.literal(true),
      state: VaultStateSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('lens.vault.response'),
      requestId,
      ok: z.literal(false),
      error: z
        .object({
          code: z.enum([
            'INVALID_REQUEST',
            'WRONG_PASSWORD',
            'NOT_CONFIGURED',
            'VAULT_ERROR',
          ]),
          message: z.string().min(1).max(500),
        })
        .strict(),
    })
    .strict(),
]);

export type VaultRequest = z.infer<typeof VaultRequestSchema>;
export type VaultResponse = z.infer<typeof VaultResponseSchema>;
export type VaultState = z.infer<typeof VaultStateSchema>;
