import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { browser } from 'wxt/browser';
import { ProviderConfigSchema } from '../../src/protocol/provider';
import { AGENT_SETTINGS_BOUNDS } from '../../src/protocol/agent-settings';
import { useAgentStore } from '../../src/sidepanel/agent-store';
import { useAgentSettingsStore } from '../../src/settings/agent-settings-store';
import { providerOriginPatternFor } from '../../src/settings/granted-sites';
import { useGrantedSitesStore } from '../../src/settings/granted-sites-store';

const TABS = [
  { id: 'provider', label: '模型与密钥' },
  { id: 'runtime', label: '运行参数' },
  { id: 'sites', label: '站点授权' },
  { id: 'about', label: '关于' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function RuntimePanel() {
  const loaded = useAgentSettingsStore((state) => state.loaded);
  const form = useAgentSettingsStore((state) => state.form);
  const busy = useAgentSettingsStore((state) => state.busy);
  const error = useAgentSettingsStore((state) => state.error);
  const notice = useAgentSettingsStore((state) => state.notice);
  const load = useAgentSettingsStore((state) => state.load);
  const setField = useAgentSettingsStore((state) => state.setField);
  const save = useAgentSettingsStore((state) => state.save);
  const reset = useAgentSettingsStore((state) => state.reset);

  useEffect(() => {
    void load();
  }, [load]);

  const bounds = AGENT_SETTINGS_BOUNDS;

  return (
    <>
      <p className="panel-intro">
        约束单次 Agent 运行的模型步数与请求规模。所有值仍受运行时硬边界限制，模型无法修改。
      </p>
      <div className="settings-form">
        <label>
          <span>
            最大模型步数（{bounds.maxSteps.min}–{bounds.maxSteps.max}，默认{' '}
            {bounds.maxSteps.fallback}）
          </span>
          <input
            inputMode="numeric"
            value={form.maxSteps}
            data-testid="runtime-max-steps"
            disabled={!loaded || busy}
            onChange={(event) => setField('maxSteps', event.target.value)}
          />
        </label>
        <label>
          <span>
            单次输入 token 上限（{bounds.maxInputTokens.min}–
            {bounds.maxInputTokens.max}，留空 = 不限制）
          </span>
          <input
            inputMode="numeric"
            value={form.maxInputTokens}
            placeholder="不限制"
            data-testid="runtime-max-input-tokens"
            disabled={!loaded || busy}
            onChange={(event) => setField('maxInputTokens', event.target.value)}
          />
        </label>
        <label>
          <span>
            单次输出 token 上限（{bounds.maxOutputTokens.min}–
            {bounds.maxOutputTokens.max}，留空 = 服务默认）
          </span>
          <input
            inputMode="numeric"
            value={form.maxOutputTokens}
            placeholder="服务默认"
            data-testid="runtime-max-output-tokens"
            disabled={!loaded || busy}
            onChange={(event) =>
              setField('maxOutputTokens', event.target.value)
            }
          />
        </label>
        <div className="runtime-actions">
          <button
            type="button"
            className="settings-action settings-action--primary"
            data-testid="save-runtime"
            disabled={!loaded || busy}
            onClick={() => void save()}
          >
            保存
          </button>
          <button
            type="button"
            className="settings-action"
            data-testid="reset-runtime"
            disabled={!loaded || busy}
            onClick={() => void reset()}
          >
            恢复默认
          </button>
        </div>
      </div>
      {error && (
        <p className="settings-error" role="alert" data-testid="runtime-error">
          {error}
        </p>
      )}
      {notice && (
        <p className="settings-success" data-testid="runtime-notice">
          {notice}
        </p>
      )}
      <p className="settings-note">
        步数决定一次运行最多咨询模型的轮数；工具调用总量随之封顶。输入上限在本地按约
        4 字符/词元裁剪页面快照、附件和过旧工具结果；输出上限随请求发送。变更对下一次运行生效。
      </p>
    </>
  );
}

function SitesPanel() {
  const provider = useAgentStore((state) => state.vault?.provider);
  const loaded = useGrantedSitesStore((state) => state.loaded);
  const sites = useGrantedSitesStore((state) => state.sites);
  const busy = useGrantedSitesStore((state) => state.busy);
  const notice = useGrantedSitesStore((state) => state.notice);
  const error = useGrantedSitesStore((state) => state.error);
  const refresh = useGrantedSitesStore((state) => state.refresh);
  const revoke = useGrantedSitesStore((state) => state.revoke);

  useEffect(() => {
    void refresh();
    const handleChange = () => void refresh();
    browser.permissions.onAdded.addListener(handleChange);
    browser.permissions.onRemoved.addListener(handleChange);
    return () => {
      browser.permissions.onAdded.removeListener(handleChange);
      browser.permissions.onRemoved.removeListener(handleChange);
    };
  }, [refresh]);

  const providerPattern = providerOriginPatternFor(provider?.baseUrl);

  return (
    <>
      <p className="panel-intro">
        以下站点持有长期访问授权。撤销后，Lens
        需要重新点击工具栏图标才能临时读取该站点页面。
      </p>
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="settings-warning" data-testid="sites-notice">
          {notice}
        </p>
      )}
      {loaded && sites.length === 0 && (
        <p className="sites-empty" data-testid="sites-empty">
          还没有站点获得长期授权。可在侧边栏「页面信息」中为当前站点授权。
        </p>
      )}
      <ul className="sites-list" data-testid="granted-sites">
        {sites.map((site) => (
          <li
            key={site.pattern}
            className="sites-item"
            data-testid="granted-site"
            data-pattern={site.pattern}
          >
            <div className="sites-item__info">
              <span className="sites-item__host">{site.host}</span>
              <span className="sites-item__pattern">{site.pattern}</span>
              <span className="sites-item__tags">
                {site.pattern === providerPattern && (
                  <span className="sites-tag">模型来源</span>
                )}
                {site.matchesAllSites && (
                  <span className="sites-tag sites-tag--broad">
                    覆盖所有站点
                  </span>
                )}
              </span>
            </div>
            <button
              type="button"
              className="settings-action"
              data-testid="revoke-granted-site"
              disabled={busy}
              onClick={() => void revoke(site.pattern)}
            >
              撤销
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function AboutPanel() {
  const manifest = browser.runtime.getManifest();

  return (
    <div className="about-panel" data-testid="about-panel">
      <div className="about-identity">
        <img src="/lens-logo.svg" alt="" className="about-logo" />
        <div>
          <h3>{manifest.name}</h3>
          <p data-testid="about-version">版本 {manifest.version}</p>
        </div>
      </div>
      <p className="panel-intro">{manifest.description}</p>
      <ul className="about-list">
        <li>本地优先：模型密钥加密保存在本机，不经过任何 Lens 服务端。</li>
        <li>受控执行：模型只能提出结构化工具调用，权限与风险由运行时裁决。</li>
        <li>提交、删除、付款等高风险操作在确认策略落地前一律被运行时阻止。</li>
      </ul>
    </div>
  );
}

export function ProviderSettings({ onClose }: { onClose: () => void }) {
  const vault = useAgentStore((state) => state.vault);
  const vaultBusy = useAgentStore((state) => state.vaultBusy);
  const error = useAgentStore((state) => state.vaultError);
  const warning = useAgentStore((state) => state.vaultWarning);
  const configure = useAgentStore((state) => state.configure);
  const unlock = useAgentStore((state) => state.unlock);
  const lock = useAgentStore((state) => state.lock);
  const clear = useAgentStore((state) => state.clear);
  const runtimeBusy = useAgentSettingsStore((state) => state.busy);
  const sitesBusy = useGrantedSitesStore((state) => state.busy);

  const [activeTab, setActiveTab] = useState<TabId>('provider');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/');
  const [model, setModel] = useState('gpt-4.1-mini');
  const [apiKey, setApiKey] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string>();
  const [confirmClear, setConfirmClear] = useState(false);
  const tabRefs = useRef(new Map<TabId, HTMLButtonElement>());
  const busy = vaultBusy || runtimeBusy || sitesBusy;

  const requestClose = () => {
    if (!busy) {
      onClose();
    }
  };

  useEffect(() => {
    if (vault?.provider) {
      setBaseUrl(vault.provider.baseUrl);
      setModel(vault.provider.model);
    }
  }, [vault?.provider]);

  const handleConfigure = async () => {
    const parsed = ProviderConfigSchema.safeParse({ baseUrl, model });
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? 'Invalid provider.');
      return;
    }
    if (!apiKey || password.length < 8) {
      setLocalError('API key and an 8+ character master password are required.');
      return;
    }
    setLocalError(undefined);
    const result = await configure(parsed.data, apiKey, password);
    if (result.saved) {
      setApiKey('');
      setPassword('');
      if (!result.warning) {
        onClose();
      }
    }
  };

  const handleUnlock = async () => {
    if (password.length < 8) {
      setLocalError('Enter the master password (8+ characters).');
      return;
    }
    setLocalError(undefined);
    if (await unlock(password)) {
      setPassword('');
      onClose();
    }
  };

  const selectTab = useCallback((tab: TabId, focus = false) => {
    setActiveTab(tab);
    if (focus) {
      tabRefs.current.get(tab)?.focus();
    }
  }, []);

  const handleTabKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === activeTab);
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % TABS.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = TABS.length - 1;
    }
    if (nextIndex !== undefined) {
      event.preventDefault();
      const nextTab = TABS[nextIndex];
      if (nextTab) {
        selectTab(nextTab.id, true);
      }
    }
  };

  return (
    <div className="settings-page">
      <header className="settings-page__topbar">
        <button
          autoFocus
          type="button"
          className="settings-back"
          aria-label="返回对话"
          data-testid="settings-back"
          disabled={busy}
          onClick={requestClose}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="settings-page__title">
          <h1>设置</h1>
          <span>Lens</span>
        </div>
      </header>

      <nav
        className="settings-tabs"
        role="tablist"
        aria-label="设置分类"
        data-testid="settings-tabs"
        onKeyDown={handleTabKeyDown}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) {
                tabRefs.current.set(tab.id, element);
              } else {
                tabRefs.current.delete(tab.id);
              }
            }}
            type="button"
            role="tab"
            id={`settings-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`settings-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className="settings-tab"
            data-testid={`settings-tab-${tab.id}`}
            disabled={busy}
            onClick={() => selectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main
        className="settings-page__content"
        data-testid="provider-settings"
      >
        {TABS.map((tab) => (
          <section
            key={tab.id}
            role="tabpanel"
            id={`settings-panel-${tab.id}`}
            aria-labelledby={`settings-tab-${tab.id}`}
            hidden={activeTab !== tab.id}
            className="settings-panel"
            data-testid={`settings-panel-${tab.id}`}
          >
            <h2>{tab.label}</h2>
            {tab.id === 'provider' && (
              <>
                <p className="panel-intro">
                  配置兼容 OpenAI
                  接口的模型服务。密钥只加密保存在本机，浏览器重启后需要重新解锁。
                </p>
                <span
                  className={`vault-state vault-state--${vault?.status ?? 'loading'}`}
                  data-testid="vault-status"
                >
                  {vault?.status ?? 'loading'}
                </span>

                {vault?.status === 'locked' ? (
                  <div className="unlock-row">
                    <input
                      type="password"
                      value={password}
                      placeholder="Master password"
                      data-testid="vault-password"
                      disabled={vaultBusy}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button
                      type="button"
                      className="settings-action"
                      disabled={vaultBusy}
                      data-testid="unlock-vault"
                      onClick={() => void handleUnlock()}
                    >
                      UNLOCK
                    </button>
                  </div>
                ) : (
                  <div className="settings-form">
                    <label>
                      <span>API 地址</span>
                      <input
                        value={baseUrl}
                        data-testid="provider-base-url"
                        disabled={vaultBusy}
                        onChange={(event) => setBaseUrl(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>模型</span>
                      <input
                        value={model}
                        data-testid="provider-model"
                        disabled={vaultBusy}
                        onChange={(event) => setModel(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>API Key</span>
                      <input
                        type="password"
                        value={apiKey}
                        placeholder={
                          vault?.status === 'unlocked' ? 'Replace key' : 'sk-…'
                        }
                        data-testid="provider-api-key"
                        disabled={vaultBusy}
                        onChange={(event) => setApiKey(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>本地主密码</span>
                      <input
                        type="password"
                        value={password}
                        placeholder="8+ characters"
                        data-testid="vault-password"
                        disabled={vaultBusy}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="settings-action settings-action--primary"
                      disabled={vaultBusy}
                      data-testid="save-provider"
                      onClick={() => void handleConfigure()}
                    >
                      {vaultBusy ? '正在加密…' : '保存并解锁'}
                    </button>
                  </div>
                )}

                {(localError || error) && (
                  <p className="settings-error" role="alert">
                    {localError ?? error}
                  </p>
                )}
                {warning && <p className="settings-warning">{warning}</p>}

                {vault && vault.status !== 'unconfigured' && (
                  <div className="settings-footer">
                    <span>
                      {vault.provider?.model} · {vault.provider?.baseUrl}
                    </span>
                    <div>
                      {vault.status === 'unlocked' && (
                        <button
                          type="button"
                          data-testid="lock-vault"
                          disabled={vaultBusy}
                          onClick={() => void lock()}
                        >
                          锁定
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid="clear-vault"
                        disabled={vaultBusy}
                        className={confirmClear ? 'is-confirming' : ''}
                        onClick={() => {
                          if (confirmClear) {
                            void clear();
                            setConfirmClear(false);
                          } else {
                            setConfirmClear(true);
                          }
                        }}
                      >
                        {confirmClear ? '确认清除' : '清除'}
                      </button>
                    </div>
                  </div>
                )}

                <p className="settings-note">
                  API Key 使用 AES-GCM
                  加密；解锁密钥只保留在当前浏览器会话中。
                </p>
              </>
            )}
            {tab.id === 'runtime' && activeTab === 'runtime' && (
              <RuntimePanel />
            )}
            {tab.id === 'sites' && activeTab === 'sites' && <SitesPanel />}
            {tab.id === 'about' && <AboutPanel />}
          </section>
        ))}
      </main>
    </div>
  );
}
