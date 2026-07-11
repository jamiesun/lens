import { create } from 'zustand';
import type { ProviderConfig } from '../protocol/provider';
import type { AgentEvent } from '../protocol/agent-events';
import type { VaultState } from '../protocol/vault-messages';
import {
  AgentClientError,
  clearVault,
  configureVault,
  getVaultState,
  lockVault,
  startAgentRun,
  unlockVault,
  type AgentRunHandle,
} from './agent-client';

export type AgentPhase = 'idle' | 'running' | 'done' | 'error';

export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

interface AgentState {
  initialized: boolean;
  vault?: VaultState;
  vaultBusy: boolean;
  vaultError?: string;
  vaultWarning?: string;
  phase: AgentPhase;
  runStatus?: string;
  events: AgentEvent[];
  messages: ChatEntry[];
  localWriteCount: number;
  assistantReply?: string;
  runError?: string;
  activeRun?: AgentRunHandle;
  runGeneration: number;
  initialize: () => Promise<void>;
  configure: (
    provider: ProviderConfig,
    apiKey: string,
    password: string,
  ) => Promise<{ saved: boolean; warning?: string }>;
  unlock: (password: string) => Promise<boolean>;
  lock: () => Promise<void>;
  clear: () => Promise<void>;
  runGoal: (goal: string) => void;
  cancelRun: () => void;
  clearConversation: () => void;
}

function describeError(error: unknown): string {
  return error instanceof AgentClientError || error instanceof Error
    ? error.message
    : String(error);
}

export const useAgentStore = create<AgentState>((set, get) => ({
  initialized: false,
  vaultBusy: false,
  phase: 'idle',
  events: [],
  messages: [],
  localWriteCount: 0,
  runGeneration: 0,

  async initialize() {
    try {
      const vault = await getVaultState();
      set({ initialized: true, vault, vaultError: undefined });
    } catch (error) {
      set({
        initialized: true,
        vaultError: describeError(error),
      });
    }
  },

  async configure(provider, apiKey, password) {
    set({ vaultBusy: true, vaultError: undefined, vaultWarning: undefined });
    try {
      const result = await configureVault(
        provider,
        apiKey,
        password,
        get().vault?.provider,
      );
      set({
        vault: result.state,
        vaultBusy: false,
        vaultWarning: result.permissionWarning,
      });
      return { saved: true, warning: result.permissionWarning };
    } catch (error) {
      set({ vaultBusy: false, vaultError: describeError(error) });
      return { saved: false };
    }
  },

  async unlock(password) {
    set({ vaultBusy: true, vaultError: undefined });
    try {
      const vault = await unlockVault(password);
      set({ vault, vaultBusy: false });
      return true;
    } catch (error) {
      set({ vaultBusy: false, vaultError: describeError(error) });
      return false;
    }
  },

  async lock() {
    get().activeRun?.cancel();
    set((state) => ({
      vaultBusy: true,
      vaultError: undefined,
      runGeneration: state.runGeneration + 1,
    }));
    try {
      const vault = await lockVault();
      set({
        vault,
        vaultBusy: false,
        phase: 'idle',
        activeRun: undefined,
      });
    } catch (error) {
      set({ vaultBusy: false, vaultError: describeError(error) });
    }
  },

  async clear() {
    get().activeRun?.cancel();
    set((state) => ({
      vaultBusy: true,
      vaultError: undefined,
      runGeneration: state.runGeneration + 1,
    }));
    try {
      const result = await clearVault(get().vault?.provider);
      set({
        vault: result.state,
        vaultBusy: false,
        vaultWarning: result.permissionWarning,
        phase: 'idle',
        events: [],
        messages: [],
        assistantReply: undefined,
        activeRun: undefined,
      });
    } catch (error) {
      set({ vaultBusy: false, vaultError: describeError(error) });
    }
  },

  runGoal(goal) {
    if (get().phase === 'running' || get().vault?.status !== 'unlocked') {
      return;
    }

    const runGeneration = get().runGeneration + 1;
    const previousMessages = get().messages;
    set({
      phase: 'running',
      runGeneration,
      events: [],
      messages: [
        ...previousMessages,
        {
          id: `user_${runGeneration}_${Date.now()}`,
          role: 'user',
          text: goal,
        },
      ],
      runStatus: 'Starting Agent',
      assistantReply: undefined,
      runError: undefined,
    });

    const activeRun = startAgentRun(
      goal,
      previousMessages
        .slice(-12)
        .map((message) => ({
          role: message.role,
          content: message.text.slice(0, 4_000),
        })),
      (event) => {
        if (get().runGeneration !== runGeneration) {
          return;
        }
        set((state) => {
          const update: Partial<AgentState> = {
            events: [...state.events, event].slice(-30),
          };

          if (event.kind === 'status') {
            update.runStatus = event.text;
          } else if (
            event.kind === 'tool' &&
            event.tool === 'page.form.fill' &&
            event.status === 'completed'
          ) {
            update.localWriteCount =
              state.localWriteCount + (event.affected ?? 0);
          } else if (event.kind === 'assistant') {
            update.assistantReply = event.text;
            update.messages = [
              ...state.messages,
              {
                id: `assistant_${runGeneration}_${Date.now()}`,
                role: 'assistant',
                text: event.text,
              },
            ];
          } else if (event.kind === 'done') {
            update.phase = 'done';
            update.runStatus = 'Complete';
            update.activeRun = undefined;
          } else if (event.kind === 'error') {
            update.phase = event.code === 'CANCELLED' ? 'idle' : 'error';
            update.runError =
              event.code === 'CANCELLED' ? undefined : event.message;
            update.runStatus =
              event.code === 'CANCELLED' ? 'Cancelled' : 'Interrupted';
            update.activeRun = undefined;
          }

          return update;
        });
      },
      () => {
        if (get().runGeneration !== runGeneration) {
          return;
        }
        set({
          phase: 'error',
          runStatus: 'Interrupted',
          runError: 'The Agent connection closed unexpectedly.',
          activeRun: undefined,
        });
      },
    );

    set({ activeRun });
  },

  cancelRun() {
    get().activeRun?.cancel();
    set({
      runStatus: 'Cancelling',
    });
  },

  clearConversation() {
    if (get().phase === 'running') {
      return;
    }
    set({
      phase: 'idle',
      runStatus: undefined,
      events: [],
      messages: [],
      assistantReply: undefined,
      runError: undefined,
    });
  },
}));
