import { create } from 'zustand';
import type { ProviderConfig } from '../protocol/provider';
import type { AgentEvent } from '../protocol/agent-events';
import type { ScreenshotMode } from '../protocol/screenshot';
import type { VaultState } from '../protocol/vault-messages';
import {
  historyRepository,
  type ConversationRecord,
  type ConversationSummary,
  type StoredChatEntry,
} from './history-repository';
import {
  AgentClientError,
  clearVault,
  configureVault,
  getVaultState,
  lockVault,
  requestPageScreenshot,
  startAgentRun,
  unlockVault,
  type AgentRunHandle,
} from './agent-client';

export type AgentPhase = 'idle' | 'running' | 'done' | 'error';

export type ChatEntry = StoredChatEntry;

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
  conversations: ConversationSummary[];
  currentConversationId?: string;
  currentConversationCreatedAt?: string;
  historyBusy: boolean;
  historyError?: string;
  screenshotBusy: boolean;
  screenshotError?: string;
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
  loadConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  captureScreenshot: (mode: ScreenshotMode) => Promise<void>;
}

function describeError(error: unknown): string {
  return error instanceof AgentClientError || error instanceof Error
    ? error.message
    : String(error);
}

function createConversationId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `conversation_${Date.now().toString(36)}`;
}

function titleFromGoal(goal: string): string {
  const normalized = goal.replace(/\s+/g, ' ').trim();
  return normalized.length > 36
    ? `${normalized.slice(0, 36)}…`
    : normalized || '新对话';
}

async function refreshConversationList(
  set: (state: Partial<AgentState>) => void,
) {
  try {
    set({ conversations: await historyRepository.list() });
  } catch (error) {
    set({ historyError: describeError(error) });
  }
}

function persistConversation(
  record: ConversationRecord,
  set: (state: Partial<AgentState>) => void,
) {
  void historyRepository
    .save(record)
    .then(() => refreshConversationList(set))
    .catch((error: unknown) => {
      set({ historyError: describeError(error) });
    });
}

let initializationPromise: Promise<void> | undefined;

export const useAgentStore = create<AgentState>((set, get) => ({
  initialized: false,
  vaultBusy: false,
  phase: 'idle',
  events: [],
  messages: [],
  conversations: [],
  historyBusy: false,
  screenshotBusy: false,
  localWriteCount: 0,
  runGeneration: 0,

  async initialize() {
    if (get().initialized) {
      return;
    }
    initializationPromise ??= (async () => {
      const [vaultResult, historyResult] = await Promise.allSettled([
        getVaultState(),
        Promise.all([
          historyRepository.loadCurrent(),
          historyRepository.list(),
        ]),
      ]);

      set({
        initialized: true,
        ...(vaultResult.status === 'fulfilled'
          ? { vault: vaultResult.value, vaultError: undefined }
          : { vaultError: describeError(vaultResult.reason) }),
        ...(historyResult.status === 'fulfilled'
          ? {
              messages: historyResult.value[0]?.messages ?? [],
              currentConversationId: historyResult.value[0]?.id,
              currentConversationCreatedAt: historyResult.value[0]?.createdAt,
              conversations: historyResult.value[1],
              historyError: undefined,
            }
          : { historyError: describeError(historyResult.reason) }),
      });
    })().finally(() => {
      initializationPromise = undefined;
    });
    await initializationPromise;
  },

  async configure(provider, apiKey, password) {
    if (!get().initialized) {
      return { saved: false };
    }
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
    if (!get().initialized) {
      return false;
    }
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
    if (!get().initialized) {
      return;
    }
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
    if (!get().initialized) {
      return;
    }
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
        currentConversationId: undefined,
        currentConversationCreatedAt: undefined,
        assistantReply: undefined,
        activeRun: undefined,
      });
    } catch (error) {
      set({ vaultBusy: false, vaultError: describeError(error) });
    }
  },

  runGoal(goal) {
    if (
      !get().initialized ||
      get().phase === 'running' ||
      get().vault?.status !== 'unlocked'
    ) {
      return;
    }

    const runGeneration = get().runGeneration + 1;
    const previousMessages = get().messages;
    const conversationId =
      get().currentConversationId ?? createConversationId();
    const createdAt =
      get().currentConversationCreatedAt ?? new Date().toISOString();
    const userMessage: ChatEntry = {
      id: `user_${runGeneration}_${Date.now()}`,
      role: 'user',
      text: goal,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...previousMessages, userMessage];
    set({
      phase: 'running',
      runGeneration,
      events: [],
      messages: nextMessages,
      currentConversationId: conversationId,
      currentConversationCreatedAt: createdAt,
      runStatus: 'Starting Agent',
      assistantReply: undefined,
      runError: undefined,
    });
    persistConversation(
      {
        id: conversationId,
        title:
          previousMessages.find((message) => message.role === 'user')?.text
            ? titleFromGoal(
                previousMessages.find((message) => message.role === 'user')!
                  .text,
              )
            : titleFromGoal(goal),
        createdAt,
        updatedAt: userMessage.createdAt,
        messages: nextMessages,
      },
      set,
    );

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
            (event.tool === 'page.form.fill' || event.tool === 'page.click') &&
            event.status === 'completed'
          ) {
            update.localWriteCount =
              state.localWriteCount + (event.affected ?? 0);
          } else if (event.kind === 'assistant') {
            update.assistantReply = event.text;
            const assistantMessage: ChatEntry = {
              id: `assistant_${runGeneration}_${Date.now()}`,
              role: 'assistant',
              text: event.text,
              createdAt: new Date().toISOString(),
            };
            const messages = [
              ...state.messages,
              assistantMessage,
            ];
            update.messages = messages;
            if (
              state.currentConversationId &&
              state.currentConversationCreatedAt
            ) {
              persistConversation(
                {
                  id: state.currentConversationId,
                  title: titleFromGoal(
                    messages.find((message) => message.role === 'user')?.text ??
                      '新对话',
                  ),
                  createdAt: state.currentConversationCreatedAt,
                  updatedAt: assistantMessage.createdAt,
                  messages,
                },
                set,
              );
            }
          } else if (event.kind === 'screenshot') {
            const screenshotMessage: ChatEntry = {
              id: `screenshot_${runGeneration}_${Date.now()}`,
              role: 'assistant',
              text:
                event.screenshot.mode === 'full-page'
                  ? '已截取整页长图。'
                  : '已截取当前可见区域。',
              createdAt: new Date().toISOString(),
              screenshot: event.screenshot,
            };
            const messages = [...state.messages, screenshotMessage];
            update.messages = messages;
            if (
              state.currentConversationId &&
              state.currentConversationCreatedAt
            ) {
              persistConversation(
                {
                  id: state.currentConversationId,
                  title: titleFromGoal(
                    messages.find((message) => message.role === 'user')?.text ??
                      '页面截图',
                  ),
                  createdAt: state.currentConversationCreatedAt,
                  updatedAt: screenshotMessage.createdAt,
                  messages,
                },
                set,
              );
            }
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
    if (!get().initialized || get().phase === 'running') {
      return;
    }
    set({
      phase: 'idle',
      runStatus: undefined,
      events: [],
      messages: [],
      currentConversationId: undefined,
      currentConversationCreatedAt: undefined,
      assistantReply: undefined,
      runError: undefined,
    });
    void historyRepository.setCurrent(undefined).catch((error: unknown) => {
      set({ historyError: describeError(error) });
    });
  },

  async loadConversation(id) {
    if (!get().initialized || get().phase === 'running') {
      return;
    }
    set({ historyBusy: true, historyError: undefined });
    try {
      const conversation = await historyRepository.get(id);
      if (!conversation) {
        throw new Error('Conversation history was not found.');
      }
      await historyRepository.setCurrent(id);
      set({
        historyBusy: false,
        messages: conversation.messages,
        currentConversationId: conversation.id,
        currentConversationCreatedAt: conversation.createdAt,
        phase: 'idle',
        events: [],
        assistantReply: undefined,
        runError: undefined,
      });
    } catch (error) {
      set({ historyBusy: false, historyError: describeError(error) });
    }
  },

  async deleteConversation(id) {
    if (!get().initialized || get().phase === 'running') {
      return;
    }
    set({ historyBusy: true, historyError: undefined });
    try {
      await historyRepository.delete(id);
      const deletingCurrent = get().currentConversationId === id;
      set({
        historyBusy: false,
        conversations: await historyRepository.list(),
        ...(deletingCurrent
          ? {
              messages: [],
              currentConversationId: undefined,
              currentConversationCreatedAt: undefined,
              events: [],
              assistantReply: undefined,
            }
          : {}),
      });
    } catch (error) {
      set({ historyBusy: false, historyError: describeError(error) });
    }
  },

  async captureScreenshot(mode) {
    if (
      !get().initialized ||
      get().screenshotBusy ||
      get().phase === 'running'
    ) {
      return;
    }
    set({ screenshotBusy: true, screenshotError: undefined });
    try {
      const screenshot = await requestPageScreenshot(mode);
      const current = get();
      const conversationId =
        current.currentConversationId ?? createConversationId();
      const createdAt =
        current.currentConversationCreatedAt ?? new Date().toISOString();
      const screenshotMessage: ChatEntry = {
        id: `screenshot_manual_${Date.now()}`,
        role: 'assistant',
        text:
          mode === 'full-page'
            ? '已截取整页长图。'
            : '已截取当前可见区域。',
        createdAt: new Date().toISOString(),
        screenshot,
      };
      const messages = [...current.messages, screenshotMessage];
      set({
        screenshotBusy: false,
        messages,
        currentConversationId: conversationId,
        currentConversationCreatedAt: createdAt,
      });
      persistConversation(
        {
          id: conversationId,
          title: titleFromGoal(
            messages.find((message) => message.role === 'user')?.text ??
              (mode === 'full-page' ? '整页长图' : '页面截图'),
          ),
          createdAt,
          updatedAt: screenshotMessage.createdAt,
          messages,
        },
        set,
      );
    } catch (error) {
      set({
        screenshotBusy: false,
        screenshotError: describeError(error),
      });
    }
  },
}));
