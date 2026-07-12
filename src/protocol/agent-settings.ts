import { z } from 'zod';

export const AGENT_SETTINGS_STORAGE_KEY = 'lens.agent.settings';

export const AGENT_SETTINGS_BOUNDS = {
  maxSteps: { min: 1, max: 240, fallback: 12 },
  maxInputTokens: { min: 1_024, max: 262_144 },
  maxOutputTokens: { min: 16, max: 32_768 },
} as const;

export const AgentSettingsSchema = z
  .object({
    maxSteps: z
      .number()
      .int()
      .min(AGENT_SETTINGS_BOUNDS.maxSteps.min)
      .max(AGENT_SETTINGS_BOUNDS.maxSteps.max),
    maxInputTokens: z
      .number()
      .int()
      .min(AGENT_SETTINGS_BOUNDS.maxInputTokens.min)
      .max(AGENT_SETTINGS_BOUNDS.maxInputTokens.max)
      .optional(),
    maxOutputTokens: z
      .number()
      .int()
      .min(AGENT_SETTINGS_BOUNDS.maxOutputTokens.min)
      .max(AGENT_SETTINGS_BOUNDS.maxOutputTokens.max)
      .optional(),
  })
  .strict();

export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  maxSteps: AGENT_SETTINGS_BOUNDS.maxSteps.fallback,
};
