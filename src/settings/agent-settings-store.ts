import { create } from 'zustand';
import { browser } from 'wxt/browser';
import {
  AGENT_SETTINGS_BOUNDS,
  AGENT_SETTINGS_STORAGE_KEY,
  AgentSettingsSchema,
  DEFAULT_AGENT_SETTINGS,
  type AgentSettings,
} from '../protocol/agent-settings';

export interface AgentSettingsForm {
  maxSteps: string;
  maxInputTokens: string;
  maxOutputTokens: string;
}

export function formFromSettings(settings: AgentSettings): AgentSettingsForm {
  return {
    maxSteps: String(settings.maxSteps),
    maxInputTokens:
      settings.maxInputTokens !== undefined
        ? String(settings.maxInputTokens)
        : '',
    maxOutputTokens:
      settings.maxOutputTokens !== undefined
        ? String(settings.maxOutputTokens)
        : '',
  };
}

function parseIntegerField(raw: string): number | undefined {
  return /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : undefined;
}

export type ParsedAgentSettingsForm =
  | { ok: true; settings: AgentSettings }
  | { ok: false; error: string };

export function parseAgentSettingsForm(
  form: AgentSettingsForm,
): ParsedAgentSettingsForm {
  const bounds = AGENT_SETTINGS_BOUNDS;
  const maxSteps = parseIntegerField(form.maxSteps);
  if (
    maxSteps === undefined ||
    maxSteps < bounds.maxSteps.min ||
    maxSteps > bounds.maxSteps.max
  ) {
    return {
      ok: false,
      error: `最大模型步数需为 ${bounds.maxSteps.min}–${bounds.maxSteps.max} 的整数。`,
    };
  }

  const candidate: AgentSettings = { maxSteps };

  if (form.maxInputTokens.trim() !== '') {
    const maxInputTokens = parseIntegerField(form.maxInputTokens);
    if (
      maxInputTokens === undefined ||
      maxInputTokens < bounds.maxInputTokens.min ||
      maxInputTokens > bounds.maxInputTokens.max
    ) {
      return {
        ok: false,
        error: `单次输入 token 上限需为 ${bounds.maxInputTokens.min}–${bounds.maxInputTokens.max} 的整数，或留空表示不限制。`,
      };
    }
    candidate.maxInputTokens = maxInputTokens;
  }

  if (form.maxOutputTokens.trim() !== '') {
    const maxOutputTokens = parseIntegerField(form.maxOutputTokens);
    if (
      maxOutputTokens === undefined ||
      maxOutputTokens < bounds.maxOutputTokens.min ||
      maxOutputTokens > bounds.maxOutputTokens.max
    ) {
      return {
        ok: false,
        error: `单次输出 token 上限需为 ${bounds.maxOutputTokens.min}–${bounds.maxOutputTokens.max} 的整数，或留空使用服务默认。`,
      };
    }
    candidate.maxOutputTokens = maxOutputTokens;
  }

  const parsed = AgentSettingsSchema.safeParse(candidate);
  return parsed.success
    ? { ok: true, settings: parsed.data }
    : { ok: false, error: '运行参数不合法，未保存。' };
}

interface AgentSettingsState {
  loaded: boolean;
  form: AgentSettingsForm;
  busy: boolean;
  error?: string;
  notice?: string;
  load: () => Promise<void>;
  setField: (field: keyof AgentSettingsForm, value: string) => void;
  save: () => Promise<void>;
  reset: () => Promise<void>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useAgentSettingsStore = create<AgentSettingsState>((set, get) => ({
  loaded: false,
  form: formFromSettings(DEFAULT_AGENT_SETTINGS),
  busy: false,

  async load() {
    if (get().loaded || get().busy) {
      return;
    }
    set({ busy: true, error: undefined, notice: undefined });
    try {
      const entries = await browser.storage.local.get(
        AGENT_SETTINGS_STORAGE_KEY,
      );
      const parsed = AgentSettingsSchema.safeParse(
        entries[AGENT_SETTINGS_STORAGE_KEY],
      );
      set({
        loaded: true,
        busy: false,
        form: formFromSettings(
          parsed.success ? parsed.data : DEFAULT_AGENT_SETTINGS,
        ),
        error: undefined,
        notice: undefined,
      });
    } catch (error) {
      set({
        loaded: true,
        busy: false,
        error: describeError(error),
        notice: undefined,
      });
    }
  },

  setField(field, value) {
    set({
      form: { ...get().form, [field]: value },
      error: undefined,
      notice: undefined,
    });
  },

  async save() {
    if (!get().loaded || get().busy) {
      return;
    }
    const parsed = parseAgentSettingsForm(get().form);
    if (!parsed.ok) {
      set({ error: parsed.error, notice: undefined });
      return;
    }
    set({ busy: true, error: undefined, notice: undefined });
    try {
      await browser.storage.local.set({
        [AGENT_SETTINGS_STORAGE_KEY]: parsed.settings,
      });
      set({
        busy: false,
        form: formFromSettings(parsed.settings),
        notice: '已保存，对下一次运行生效。',
      });
    } catch (error) {
      set({ busy: false, error: describeError(error) });
    }
  },

  async reset() {
    if (!get().loaded || get().busy) {
      return;
    }
    set({ busy: true, error: undefined, notice: undefined });
    try {
      await browser.storage.local.remove(AGENT_SETTINGS_STORAGE_KEY);
      set({
        busy: false,
        form: formFromSettings(DEFAULT_AGENT_SETTINGS),
        notice: '已恢复默认运行参数。',
      });
    } catch (error) {
      set({ busy: false, error: describeError(error) });
    }
  },
}));
