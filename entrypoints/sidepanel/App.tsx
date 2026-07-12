import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import type {
  FormDescriptor,
  FormFieldDescriptor,
} from '../../src/protocol/page-snapshot';
import type {
  FieldFillOutcome,
  FillFieldValue,
} from '../../src/protocol/page-commands';
import type { AgentAttachment } from '../../src/protocol/agent-events';
import { useAgentStore } from '../../src/sidepanel/agent-store';
import {
  FILE_ATTACHMENT_ACCEPT,
  formatFileSize,
  readFileAttachments,
} from '../../src/sidepanel/file-attachments';
import { useObserverStore } from '../../src/sidepanel/observer-store';
import { useSiteAccessStore } from '../../src/sidepanel/site-access-store';
import { useModalFocus } from '../../src/sidepanel/use-modal-focus';
import { shouldHandleActionInvocation } from '../../src/protocol/messages';
import { AssistantMarkdown } from '../../src/sidepanel/assistant-markdown';
import { ProviderSettings } from './ProviderSettings';

const EDITABLE_FIELD_TYPES = new Set([
  'text',
  'email',
  'tel',
  'url',
  'search',
  'number',
  'textarea',
]);

function isEditableField(field: FormFieldDescriptor): boolean {
  return !field.sensitive && EDITABLE_FIELD_TYPES.has(field.fieldType);
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </svg>
  );
}

function ContextIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 9h8M8 13h5" />
    </svg>
  );
}

function NewChatIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7" />
      <path d="m14 4 6 6M17 3l4 4-8 8-4 1 1-4 7-7Z" />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5M12 7v5l3 2" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 12 16-8-5 16-3-6-8-2Z" />
      <path d="m12 14 8-10" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6Z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

function FillBadge({ outcome }: { outcome?: FieldFillOutcome }) {
  if (!outcome) {
    return null;
  }
  return (
    <span
      className={`fill-receipt fill-receipt--${outcome.status}`}
      data-testid="fill-badge"
    >
      {outcome.status === 'filled' ? '已填写' : outcome.reason}
    </span>
  );
}

function FormEditor({
  form,
  outcomes,
  busy,
  onFill,
}: {
  form: FormDescriptor;
  outcomes: Record<string, FieldFillOutcome>;
  busy: boolean;
  onFill: (formNodeId: string, fields: FillFieldValue[]) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const fields = Object.entries(draft)
    .filter(([, value]) => value.length > 0)
    .map(([nodeId, value]) => ({ nodeId, value }));

  return (
    <article className="context-form">
      <div className="context-form__title">
        <strong>{form.label ?? form.formId}</strong>
        <span>{form.validationState}</span>
      </div>
      {form.fields.map((field) =>
        isEditableField(field) ? (
          <label className="context-field" key={field.nodeId}>
            <span>{field.label ?? field.name ?? field.fieldType}</span>
            <input
              value={draft[field.nodeId] ?? ''}
              placeholder={field.hasValue ? '保留现值' : '输入内容'}
              data-field-name={field.name ?? field.nodeId}
              disabled={busy}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  [field.nodeId]: event.target.value,
                }))
              }
            />
            <FillBadge outcome={outcomes[field.nodeId]} />
          </label>
        ) : (
          <div className="context-field context-field--locked" key={field.nodeId}>
            <span>{field.label ?? field.name ?? field.fieldType}</span>
            <em>{field.sensitive ? 'MASKED' : field.fieldType}</em>
          </div>
        ),
      )}
      <button
        type="button"
        className="secondary-button"
        disabled={busy || fields.length === 0}
        data-testid={`apply-fill-${form.formId}`}
        onClick={() => onFill(form.nodeId, fields)}
      >
        {busy ? '正在填写…' : '应用填写'}
      </button>
    </article>
  );
}

function SiteAccessSection() {
  const access = useSiteAccessStore((state) => state.access);
  const busy = useSiteAccessStore((state) => state.busy);
  const notice = useSiteAccessStore((state) => state.notice);
  const grant = useSiteAccessStore((state) => state.grant);
  const revoke = useSiteAccessStore((state) => state.revoke);

  if (access.kind === 'unsupported') {
    return null;
  }

  const host = 'host' in access ? access.host : undefined;
  const statusLabel =
    access.kind === 'persistent'
      ? '已长期授权，切换标签页后仍可访问'
      : access.kind === 'temporary'
        ? '临时访问，仅本次有效'
        : '未授权，点击浏览器工具栏中的 Lens 图标以授权当前页面';

  return (
    <section
      className="site-access"
      data-testid="site-access"
      data-status={access.kind}
    >
      <div className="site-access__row">
        <div className="site-access__meta">
          <strong>{host ?? '站点访问'}</strong>
          <span>{statusLabel}</span>
        </div>
        {access.kind === 'temporary' && (
          <button
            type="button"
            data-testid="grant-site-access"
            disabled={busy}
            onClick={() => void grant()}
          >
            {busy ? '请求中…' : '长期授权'}
          </button>
        )}
        {access.kind === 'persistent' && (
          <button
            type="button"
            data-testid="revoke-site-access"
            disabled={busy}
            onClick={() => void revoke()}
          >
            {busy ? '处理中…' : '取消授权'}
          </button>
        )}
      </div>
      {notice && (
        <p
          className="site-access__notice"
          data-testid="site-access-notice"
          role="status"
        >
          {notice}
        </p>
      )}
    </section>
  );
}

function PageContextDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const phase = useObserverStore((state) => state.phase);
  const snapshot = useObserverStore((state) => state.snapshot);
  const error = useObserverStore((state) => state.error);
  const trace = useObserverStore((state) => state.trace);
  const fillingFormId = useObserverStore((state) => state.fillingFormId);
  const outcomes = useObserverStore((state) => state.fillOutcomes);
  const scanPage = useObserverStore((state) => state.scanPage);
  const fillForm = useObserverStore((state) => state.fillForm);
  const screenshotBusy = useAgentStore((state) => state.screenshotBusy);
  const screenshotError = useAgentStore((state) => state.screenshotError);
  const captureScreenshot = useAgentStore((state) => state.captureScreenshot);
  const dialogRef = useModalFocus<HTMLElement>(open, onClose);

  if (!open) {
    return null;
  }

  const fieldCount =
    snapshot?.forms.reduce((total, form) => total + form.fields.length, 0) ?? 0;

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        ref={dialogRef}
        tabIndex={-1}
        className="context-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="context-title"
        data-testid="page-context"
      >
        <header className="drawer-header">
          <div>
            <h2 id="context-title">当前页面</h2>
            <p>页面分析与手动工具</p>
          </div>
          <button type="button" aria-label="关闭页面信息" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <button
          type="button"
          className="scan-page-button"
          data-testid="scan-page"
          disabled={phase === 'scanning' || Boolean(fillingFormId)}
          onClick={() => void scanPage()}
        >
          {phase === 'scanning' ? '正在读取页面…' : snapshot ? '重新读取页面' : '读取页面'}
        </button>

        <SiteAccessSection />

        {error && (
          <div
            className="context-error"
            data-testid="error-banner"
            data-error-code={error.code}
            role="alert"
          >
            <strong>{error.title}</strong>
            <p>{error.message}</p>
          </div>
        )}

        <div className="capture-actions">
          <button
            type="button"
            disabled={screenshotBusy || phase !== 'ready'}
            data-testid="capture-viewport"
            onClick={() => void captureScreenshot('viewport')}
          >
            {screenshotBusy ? '正在截图…' : '截取当前画面'}
          </button>
          <button
            type="button"
            disabled={screenshotBusy || phase !== 'ready'}
            data-testid="capture-full-page"
            onClick={() => void captureScreenshot('full-page')}
          >
            {screenshotBusy ? '正在拼接…' : '截取整页长图'}
          </button>
        </div>
        {screenshotError && (
          <p className="capture-error" role="alert">
            {screenshotError}
          </p>
        )}

        {snapshot && phase === 'ready' && (
          <>
            <section className="page-summary-card">
              <h3 data-testid="page-title">{snapshot.title}</h3>
              <p>{snapshot.visibleTextSummary ?? '此页面没有可安全提取的摘要。'}</p>
              <div className="page-metrics">
                <span>
                  <b data-testid="form-count">{snapshot.forms.length}</b> 个表单
                </span>
                <span>{fieldCount} 个字段</span>
                <span>{snapshot.actions.length} 个操作</span>
              </div>
            </section>

            <details className="drawer-details">
              <summary data-testid="manual-tools-toggle">手动填写表单</summary>
              <div className="drawer-details__content">
                {snapshot.forms.length === 0 ? (
                  <p className="empty-copy">没有发现可填写表单。</p>
                ) : (
                  snapshot.forms.map((form) => (
                    <FormEditor
                      key={form.nodeId}
                      form={form}
                      outcomes={outcomes}
                      busy={fillingFormId === form.nodeId}
                      onFill={(formNodeId, fields) =>
                        void fillForm(formNodeId, fields)
                      }
                    />
                  ))
                )}
              </div>
            </details>

            <details className="drawer-details">
              <summary>页面操作与日志</summary>
              <div className="drawer-details__content">
                {snapshot.actions.map((action) => (
                  <div className="context-action" key={action.nodeId}>
                    <span>{action.label}</span>
                    <em>{action.declaredRisk ?? 'unrated'}</em>
                  </div>
                ))}
                {trace.map((entry) => (
                  <div className="context-action" key={entry.id}>
                    <span>{entry.tool}</span>
                    <em>{entry.status} · {entry.detail}</em>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
      </aside>
    </div>
  );
}

function HistoryDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const conversations = useAgentStore((state) => state.conversations);
  const currentId = useAgentStore((state) => state.currentConversationId);
  const busy = useAgentStore((state) => state.historyBusy);
  const error = useAgentStore((state) => state.historyError);
  const loadConversation = useAgentStore((state) => state.loadConversation);
  const deleteConversation = useAgentStore((state) => state.deleteConversation);
  const dialogRef = useModalFocus<HTMLElement>(open, onClose);

  if (!open) {
    return null;
  }

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <aside
        ref={dialogRef}
        tabIndex={-1}
        className="context-drawer history-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-title"
        data-testid="history-drawer"
      >
        <header className="drawer-header">
          <div>
            <h2 id="history-title">历史记录</h2>
            <p>仅保存在本机，最多保留 30 个会话</p>
          </div>
          <button
            type="button"
            aria-label="关闭历史记录"
            disabled={busy}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        {error && <p className="history-error">{error}</p>}
        {conversations.length === 0 ? (
          <div className="history-empty">
            <HistoryIcon />
            <p>还没有历史会话</p>
          </div>
        ) : (
          <ol className="history-list">
            {conversations.map((conversation) => (
              <li
                key={conversation.id}
                className={
                  conversation.id === currentId ? 'is-current' : undefined
                }
              >
                <button
                  type="button"
                  className="history-open"
                  disabled={busy}
                  data-testid="history-entry"
                  onClick={() => {
                    void loadConversation(conversation.id).then(onClose);
                  }}
                >
                  <strong>{conversation.title}</strong>
                  <span>
                    {new Date(conversation.updatedAt).toLocaleString()} ·{' '}
                    {conversation.messageCount} 条消息
                  </span>
                </button>
                <button
                  type="button"
                  className="history-delete"
                  aria-label={`删除 ${conversation.title}`}
                  disabled={busy}
                  onClick={() => void deleteConversation(conversation.id)}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}

function ToolActivity() {
  const phase = useAgentStore((state) => state.phase);
  const status = useAgentStore((state) => state.runStatus);
  const events = useAgentStore((state) => state.events);
  const tools = events.filter((event) => event.kind === 'tool');

  if (phase !== 'running' && tools.length === 0) {
    return null;
  }

  return (
    <div className="assistant-row">
      <span className="assistant-mark">
        <img src="/lens-logo.svg" alt="" />
      </span>
      <div className="activity-block">
        {phase === 'running' && (
          <div className="thinking-line" data-testid="agent-status">
            <span className="thinking-dot" />
            {status ?? '正在处理'}
          </div>
        )}
        {tools.length > 0 && (
          <details open={phase === 'running'} data-testid="agent-events">
            <summary>
              {phase === 'running' ? '正在操作页面' : `已执行 ${tools.length} 个页面操作`}
            </summary>
            {tools.map((event, index) =>
              event.kind === 'tool' ? (
                <p key={`${event.tool}-${index}`}>
                  {event.tool} · {event.status} · {event.detail}
                </p>
              ) : null,
            )}
          </details>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [attachments, setAttachments] = useState<AgentAttachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [draft, setDraft] = useState('');
  const chatEnd = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const addMenu = useRef<HTMLDivElement>(null);
  const settingsToggle = useRef<HTMLButtonElement>(null);
  const settingsShouldRestoreFocus = useRef(false);

  const vault = useAgentStore((state) => state.vault);
  const initialized = useAgentStore((state) => state.initialized);
  const initializeAgent = useAgentStore((state) => state.initialize);
  const agentPhase = useAgentStore((state) => state.phase);
  const messages = useAgentStore((state) => state.messages);
  const runError = useAgentStore((state) => state.runError);
  const runGoal = useAgentStore((state) => state.runGoal);
  const cancelRun = useAgentStore((state) => state.cancelRun);
  const clearConversation = useAgentStore((state) => state.clearConversation);
  const agentLocalWriteCount = useAgentStore((state) => state.localWriteCount);

  const observerPhase = useObserverStore((state) => state.phase);
  const snapshot = useObserverStore((state) => state.snapshot);
  const observerError = useObserverStore((state) => state.error);
  const scanPage = useObserverStore((state) => state.scanPage);
  const invalidatePage = useObserverStore((state) => state.invalidatePage);
  const manualWriteCount = useObserverStore((state) => state.localWriteCount);
  const refreshSiteAccess = useSiteAccessStore((state) => state.refresh);

  useEffect(() => {
    void initializeAgent();
  }, [initializeAgent]);

  useEffect(() => {
    if (initialized) {
      void scanPage();
    }
  }, [initialized, scanPage]);

  useEffect(() => {
    if (agentPhase === 'done') {
      void scanPage();
    }
  }, [agentPhase, scanPage]);

  useEffect(() => {
    if (observerPhase === 'ready' || observerPhase === 'error') {
      void refreshSiteAccess();
    }
  }, [observerPhase, refreshSiteAccess]);

  useEffect(() => {
    let panelWindowId: number | undefined;
    void browser.windows
      .getCurrent()
      .then((window) => {
        panelWindowId = window.id;
      })
      .catch(() => {
        panelWindowId = undefined;
      });

    // A toolbar click is the moment Chrome arms activeTab for the page, so
    // rescan immediately instead of leaving the stale denied state on screen.
    const handleMessage = (message: unknown) => {
      if (!shouldHandleActionInvocation(message, panelWindowId)) {
        return;
      }
      const observer = useObserverStore.getState();
      if (observer.phase !== 'ready') {
        void observer.scanPage();
      }
      void refreshSiteAccess();
    };

    browser.runtime.onMessage.addListener(handleMessage);
    return () => {
      browser.runtime.onMessage.removeListener(handleMessage);
    };
  }, [refreshSiteAccess]);

  useEffect(() => {
    const handleAdded = () => {
      void refreshSiteAccess();
      const observer = useObserverStore.getState();
      if (
        observer.phase === 'error' &&
        observer.error?.code === 'PAGE_ACCESS_DENIED'
      ) {
        void observer.scanPage();
      }
    };
    const handleRemoved = () => void refreshSiteAccess();

    browser.permissions.onAdded.addListener(handleAdded);
    browser.permissions.onRemoved.addListener(handleRemoved);
    return () => {
      browser.permissions.onAdded.removeListener(handleAdded);
      browser.permissions.onRemoved.removeListener(handleRemoved);
    };
  }, [refreshSiteAccess]);

  useEffect(() => {
    const handleActivated = () => invalidatePage();
    const handleUpdated = (
      _tabId: number,
      changeInfo: { status?: string },
      tab: { active?: boolean; url?: string },
    ) => {
      if (
        tab.active &&
        changeInfo.status === 'loading' &&
        !tab.url?.startsWith(browser.runtime.getURL(''))
      ) {
        invalidatePage();
      }
    };

    browser.tabs.onActivated.addListener(handleActivated);
    browser.tabs.onUpdated.addListener(handleUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(handleActivated);
      browser.tabs.onUpdated.removeListener(handleUpdated);
    };
  }, [invalidatePage]);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, agentPhase]);

  useEffect(() => {
    if (!settingsOpen && settingsShouldRestoreFocus.current) {
      settingsShouldRestoreFocus.current = false;
      settingsToggle.current?.focus();
    }
  }, [settingsOpen]);

  useEffect(() => {
    if (!addMenuOpen) {
      return;
    }
    const closeMenu = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') {
          setAddMenuOpen(false);
        }
        return;
      }
      if (
        event.target instanceof Node &&
        !addMenu.current?.contains(event.target)
      ) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeMenu);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeMenu);
    };
  }, [addMenuOpen]);

  if (!initialized) {
    return (
      <div className="chat-app chat-app--loading" data-testid="app-loading">
        <img src="/lens-logo.svg" alt="" className="loading-logo" />
        <span>正在加载本地会话…</span>
      </div>
    );
  }

  const submitGoal = (goal: string) => {
    const normalized =
      goal.trim() || (attachments.length > 0 ? '请阅读并分析附件。' : '');
    if (
      !normalized ||
      vault?.status !== 'unlocked' ||
      agentPhase === 'running' ||
      attachmentBusy
    ) {
      return;
    }
    const submittedAttachments = attachments;
    setDraft('');
    setAttachments([]);
    setAttachmentError(undefined);
    setAddMenuOpen(false);
    runGoal(normalized, submittedAttachments);
  };

  const addFiles = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }
    setAttachmentBusy(true);
    setAttachmentError(undefined);
    try {
      setAttachments(await readFileAttachments(files, attachments));
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : '无法添加所选文件。',
      );
    } finally {
      setAttachmentBusy(false);
    }
  };

  const startNewConversation = () => {
    setDraft('');
    setAttachments([]);
    setAttachmentError(undefined);
    setAddMenuOpen(false);
    clearConversation();
  };

  const closeSettings = () => {
    settingsShouldRestoreFocus.current = true;
    setSettingsOpen(false);
  };

  const pageLabel =
    (observerPhase === 'ready' ? snapshot?.title : undefined) ??
    (observerPhase === 'scanning'
      ? '正在读取当前页面'
      : observerError
        ? '无法读取当前页面'
        : '当前页面');

  return (
    <div className="chat-app">
      {settingsOpen ? (
        <ProviderSettings onClose={closeSettings} />
      ) : (
        <>
          <div
            className="chat-frame"
            data-testid="chat-view"
            aria-hidden={contextOpen || historyOpen ? true : undefined}
          >
        <header className="chat-header">
        <div className="chat-title">
          <img src="/lens-logo.svg" alt="" className="lens-logo" />
          <h1>Lens</h1>
          <span
            className={`page-status page-status--${observerPhase}`}
            data-testid="scan-status"
            data-phase={observerPhase}
          />
        </div>
        <nav className="header-actions" aria-label="对话操作">
          <button
            type="button"
            aria-label="新建对话"
            title="新建对话"
            data-testid="new-chat"
            onClick={startNewConversation}
          >
            <NewChatIcon />
          </button>
          <button
            type="button"
            aria-label="历史记录"
            title="历史记录"
            data-testid="history-toggle"
            onClick={() => {
              setAddMenuOpen(false);
              setSettingsOpen(false);
              setContextOpen(false);
              setHistoryOpen(true);
            }}
          >
            <HistoryIcon />
          </button>
          <button
            type="button"
            aria-label="页面信息"
            title="页面信息"
            data-testid="context-toggle"
            onClick={() => {
              setAddMenuOpen(false);
              setSettingsOpen(false);
              setHistoryOpen(false);
              setContextOpen(true);
            }}
          >
            <ContextIcon />
          </button>
          <button
            ref={settingsToggle}
            type="button"
            aria-label="设置"
            title="设置"
            data-testid="settings-toggle"
            data-vault-status={vault?.status ?? 'loading'}
            onClick={() => {
              setAddMenuOpen(false);
              setContextOpen(false);
              setHistoryOpen(false);
              setSettingsOpen(true);
            }}
          >
            <SettingsIcon />
          </button>
        </nav>
        </header>

        <main className="chat-thread">
        {messages.length === 0 && (
          <div className="welcome-block" data-testid="chat-welcome">
            <span className="welcome-spark">
              <img src="/lens-logo.svg" alt="" />
            </span>
            <h2>想让我在这个页面做什么？</h2>
            <p>
              我可以读取页面、理解表单并填写内容。提交、删除、付款等操作仍然保持锁定。
            </p>

            {vault?.status !== 'unlocked' ? (
              <button
                type="button"
                className="setup-prompt"
                onClick={() => {
                  setContextOpen(false);
                  setHistoryOpen(false);
                  setSettingsOpen(true);
                }}
              >
                {vault?.status === 'locked' ? '解锁模型' : '配置模型'}
              </button>
            ) : (
              <div className="suggestion-list">
                {[
                  '告诉我这个页面能做什么',
                  '帮我填写当前表单',
                  '检查页面上有没有错误提示',
                ].map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    onClick={() => submitGoal(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((message, index) =>
          message.role === 'user' ? (
            <div className="user-row" key={message.id} data-chat-role="user">
              <div className="user-bubble">
                {message.attachments?.length ? (
                  <div
                    className="message-attachments"
                    data-testid="message-attachments"
                  >
                    {message.attachments.map((attachment) => (
                      <span key={`${attachment.name}-${attachment.size}`}>
                        <FileIcon />
                        <span>{attachment.name}</span>
                        <small>{formatFileSize(attachment.size)}</small>
                      </span>
                    ))}
                  </div>
                ) : null}
                <span className="user-bubble__text">{message.text}</span>
              </div>
            </div>
          ) : (
            <div
              className="assistant-row"
              key={message.id}
              data-chat-role="assistant"
            >
              <span className="assistant-mark">
                <img src="/lens-logo.svg" alt="" />
              </span>
              <div
                className="assistant-message"
                data-testid={index === messages.length - 1 ? 'assistant-reply' : undefined}
              >
                <AssistantMarkdown>{message.text}</AssistantMarkdown>
                {message.screenshot && (
                  <figure
                    className="screenshot-card"
                    data-screenshot-mode={message.screenshot.mode}
                  >
                    <img
                      src={message.screenshot.dataUrl}
                      alt={
                        message.screenshot.mode === 'full-page'
                          ? '整页长截图预览'
                          : '当前页面截图预览'
                      }
                      data-testid="screenshot-preview"
                    />
                    <figcaption>
                      <span>
                        {message.screenshot.width} × {message.screenshot.height}
                        {message.screenshot.truncated ? ' · 已达到长度上限' : ''}
                      </span>
                      <a
                        href={message.screenshot.dataUrl}
                        download={message.screenshot.filename}
                        data-testid="screenshot-download"
                      >
                        下载
                      </a>
                    </figcaption>
                  </figure>
                )}
              </div>
            </div>
          ),
        )}

        <ToolActivity />

        {runError && (
          <div className="assistant-row">
            <span className="assistant-mark assistant-mark--error">!</span>
            <div className="assistant-message assistant-message--error" role="alert">
              {runError}
            </div>
          </div>
        )}

        {observerError && (
          <button
            type="button"
            className="page-error-banner"
            data-testid="error-banner"
            data-error-code={observerError.code}
            onClick={() => setContextOpen(true)}
          >
            <strong>{observerError.title}</strong>
            <span>{observerError.message}</span>
          </button>
        )}
        <div ref={chatEnd} />
        </main>

        <footer className="composer-shell">
        <button
          type="button"
          className="context-chip"
          data-testid="context-chip"
          onClick={() => {
            setSettingsOpen(false);
            setHistoryOpen(false);
            setContextOpen(true);
          }}
        >
          <ContextIcon />
          <span>{pageLabel}</span>
          <em>
            {manualWriteCount + agentLocalWriteCount > 0
              ? `已修改 ${manualWriteCount + agentLocalWriteCount} 项`
              : '未提交任何操作'}
          </em>
        </button>

        <div className="composer-box">
          {attachments.length > 0 && (
            <div className="attachment-list" data-testid="attachment-list">
              {attachments.map((attachment) => (
                <div
                  className="attachment-chip"
                  data-testid="attachment-chip"
                  key={`${attachment.name}-${attachment.size}`}
                >
                  <FileIcon />
                  <span>
                    <strong title={attachment.name}>{attachment.name}</strong>
                    <small>{formatFileSize(attachment.size)}</small>
                  </span>
                  <button
                    type="button"
                    aria-label={`移除文件 ${attachment.name}`}
                    disabled={agentPhase === 'running'}
                    onClick={() => {
                      setAttachments((current) =>
                        current.filter(
                          (candidate) => candidate.name !== attachment.name,
                        ),
                      );
                      setAttachmentError(undefined);
                    }}
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            value={draft}
            rows={2}
            data-testid="agent-goal"
            placeholder={
              vault?.status === 'unlocked'
                ? attachments.length > 0
                  ? '补充你希望如何处理这些文件（可选）'
                  : '输入你想在当前页面完成的事情'
                : '请先配置或解锁模型'
            }
            disabled={vault?.status !== 'unlocked' || agentPhase === 'running'}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                submitGoal(draft);
              }
            }}
          />
          {attachmentError && (
            <p
              className="attachment-error"
              data-testid="attachment-error"
              role="alert"
            >
              {attachmentError}
            </p>
          )}
          <div className="composer-actions">
            <div className="composer-add" ref={addMenu}>
              <button
                type="button"
                className={`composer-icon${addMenuOpen ? ' is-open' : ''}`}
                aria-label="添加内容"
                aria-controls="composer-add-menu"
                aria-expanded={addMenuOpen}
                title="添加内容"
                data-testid="attachment-toggle"
                disabled={
                  vault?.status !== 'unlocked' ||
                  agentPhase === 'running' ||
                  attachmentBusy
                }
                onClick={() => setAddMenuOpen((open) => !open)}
              >
                <PlusIcon />
              </button>
              {addMenuOpen && (
                <div
                  className="composer-add-menu"
                  id="composer-add-menu"
                  data-testid="composer-add-menu"
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    data-testid="file-picker-trigger"
                    onClick={() => {
                      setAddMenuOpen(false);
                      fileInput.current?.click();
                    }}
                  >
                    <FileIcon />
                    <span>
                      <strong>添加文件</strong>
                      <small>文本、代码或数据 · 单个 32 KB</small>
                    </span>
                  </button>
                </div>
              )}
              <input
                ref={fileInput}
                type="file"
                hidden
                multiple
                accept={FILE_ATTACHMENT_ACCEPT}
                data-testid="attachment-input"
                disabled={
                  vault?.status !== 'unlocked' ||
                  agentPhase === 'running' ||
                  attachmentBusy
                }
                onChange={(event) => {
                  const files = Array.from(event.currentTarget.files ?? []);
                  event.currentTarget.value = '';
                  void addFiles(files);
                }}
              />
            </div>
            {agentPhase === 'running' ? (
              <button
                type="button"
                className="send-button send-button--stop"
                aria-label="停止"
                data-testid="stop-agent"
                onClick={cancelRun}
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="button"
                className="send-button"
                aria-label="发送"
                data-testid="run-agent"
                disabled={
                  (!draft.trim() && attachments.length === 0) ||
                  vault?.status !== 'unlocked' ||
                  attachmentBusy
                }
                onClick={() => submitGoal(draft)}
              >
                <SendIcon />
              </button>
            )}
          </div>
        </div>
        <span
          className="write-gate-copy"
          data-testid="write-gate"
        >
          本地填写与点击可自动执行 · 提交和高风险操作已被运行时阻止
        </span>
        </footer>
          </div>

          <PageContextDrawer
            open={contextOpen}
            onClose={() => setContextOpen(false)}
          />
          <HistoryDrawer
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
          />
        </>
      )}
    </div>
  );
}
