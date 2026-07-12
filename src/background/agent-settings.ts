import {
  AGENT_SETTINGS_STORAGE_KEY,
  AgentSettingsSchema,
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
} from '../protocol/agent-settings';

export interface AgentSettingsStorage {
  get(key: string): Promise<Record<string, unknown>>;
}

export async function readAgentSettings(
  storage: AgentSettingsStorage,
): Promise<AgentSettings> {
  let stored: unknown;
  try {
    const entries = await storage.get(AGENT_SETTINGS_STORAGE_KEY);
    stored = entries[AGENT_SETTINGS_STORAGE_KEY];
  } catch {
    return DEFAULT_AGENT_SETTINGS;
  }
  const parsed = AgentSettingsSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_AGENT_SETTINGS;
}
