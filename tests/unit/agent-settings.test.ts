import { describe, expect, it } from 'vitest';
import {
  AGENT_SETTINGS_STORAGE_KEY,
  AgentSettingsSchema,
  DEFAULT_AGENT_SETTINGS,
} from '../../src/protocol/agent-settings';
import { readAgentSettings } from '../../src/background/agent-settings';
import {
  formFromSettings,
  parseAgentSettingsForm,
} from '../../src/settings/agent-settings-store';

describe('AgentSettingsSchema', () => {
  it('accepts values inside the hard bounds', () => {
    expect(
      AgentSettingsSchema.safeParse({
        maxSteps: 240,
        maxInputTokens: 1_024,
        maxOutputTokens: 32_768,
      }).success,
    ).toBe(true);
    expect(AgentSettingsSchema.safeParse({ maxSteps: 1 }).success).toBe(true);
  });

  it('rejects unbounded, non-integer, and unknown values', () => {
    expect(AgentSettingsSchema.safeParse({ maxSteps: 0 }).success).toBe(false);
    expect(AgentSettingsSchema.safeParse({ maxSteps: 241 }).success).toBe(
      false,
    );
    expect(AgentSettingsSchema.safeParse({ maxSteps: 2.5 }).success).toBe(
      false,
    );
    expect(
      AgentSettingsSchema.safeParse({ maxSteps: 12, maxOutputTokens: 8 })
        .success,
    ).toBe(false);
    expect(
      AgentSettingsSchema.safeParse({ maxSteps: 12, extra: true }).success,
    ).toBe(false);
  });
});

describe('readAgentSettings', () => {
  it('returns stored settings when they are valid', async () => {
    const settings = await readAgentSettings({
      get: async () => ({
        [AGENT_SETTINGS_STORAGE_KEY]: {
          maxSteps: 24,
          maxOutputTokens: 2_048,
        },
      }),
    });
    expect(settings).toEqual({ maxSteps: 24, maxOutputTokens: 2_048 });
  });

  it.each([
    ['missing entry', {}],
    ['corrupted entry', { [AGENT_SETTINGS_STORAGE_KEY]: { maxSteps: 9_999 } }],
    ['wrong shape', { [AGENT_SETTINGS_STORAGE_KEY]: 'twelve' }],
  ])('falls back to defaults on %s', async (_label, stored) => {
    expect(await readAgentSettings({ get: async () => stored })).toEqual(
      DEFAULT_AGENT_SETTINGS,
    );
  });

  it('falls back to defaults when storage cannot be read', async () => {
    const settings = await readAgentSettings({
      get: async () => {
        throw new Error('storage unavailable');
      },
    });
    expect(settings).toEqual(DEFAULT_AGENT_SETTINGS);
  });
});

describe('parseAgentSettingsForm', () => {
  it('parses a filled form and drops empty optional fields', () => {
    expect(
      parseAgentSettingsForm({
        maxSteps: '24',
        maxInputTokens: ' 8192 ',
        maxOutputTokens: '',
      }),
    ).toEqual({
      ok: true,
      settings: { maxSteps: 24, maxInputTokens: 8_192 },
    });
  });

  it('round-trips through formFromSettings', () => {
    const form = formFromSettings({ maxSteps: 12, maxOutputTokens: 4_096 });
    expect(form).toEqual({
      maxSteps: '12',
      maxInputTokens: '',
      maxOutputTokens: '4096',
    });
    expect(parseAgentSettingsForm(form)).toEqual({
      ok: true,
      settings: { maxSteps: 12, maxOutputTokens: 4_096 },
    });
  });

  it.each([
    ['empty steps', { maxSteps: '', maxInputTokens: '', maxOutputTokens: '' }],
    ['zero steps', { maxSteps: '0', maxInputTokens: '', maxOutputTokens: '' }],
    [
      'steps above the hard bound',
      { maxSteps: '999', maxInputTokens: '', maxOutputTokens: '' },
    ],
    [
      'non-numeric tokens',
      { maxSteps: '12', maxInputTokens: 'many', maxOutputTokens: '' },
    ],
    [
      'output below minimum',
      { maxSteps: '12', maxInputTokens: '', maxOutputTokens: '8' },
    ],
  ])('rejects %s with a readable error', (_label, form) => {
    const parsed = parseAgentSettingsForm(form);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.length).toBeGreaterThan(0);
    }
  });
});
