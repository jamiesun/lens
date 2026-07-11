import { z } from 'zod';

export const ProviderConfigSchema = z
  .object({
    baseUrl: z
      .url()
      .max(500)
      .refine((value) => {
        const url = new URL(value);
        const isLoopback =
          url.hostname === '127.0.0.1' ||
          url.hostname === 'localhost';
        return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback);
      }, 'Provider URL must use HTTPS or a loopback HTTP address.')
      .refine((value) => {
        const url = new URL(value);
        return !url.username && !url.password && !url.search && !url.hash;
      }, 'Provider URL must not contain credentials, query, or fragment.'),
    model: z.string().min(1).max(200),
  })
  .strict();

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
