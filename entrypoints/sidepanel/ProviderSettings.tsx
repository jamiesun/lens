import { useEffect, useState } from 'react';
import { ProviderConfigSchema } from '../../src/protocol/provider';
import { useAgentStore } from '../../src/sidepanel/agent-store';
import { useModalFocus } from '../../src/sidepanel/use-modal-focus';

export function ProviderSettings({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const vault = useAgentStore((state) => state.vault);
  const busy = useAgentStore((state) => state.vaultBusy);
  const error = useAgentStore((state) => state.vaultError);
  const warning = useAgentStore((state) => state.vaultWarning);
  const configure = useAgentStore((state) => state.configure);
  const unlock = useAgentStore((state) => state.unlock);
  const lock = useAgentStore((state) => state.lock);
  const clear = useAgentStore((state) => state.clear);

  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/');
  const [model, setModel] = useState('gpt-4.1-mini');
  const [apiKey, setApiKey] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string>();
  const [confirmClear, setConfirmClear] = useState(false);
  const requestClose = () => {
    if (!busy) {
      onClose();
    }
  };
  const dialogRef = useModalFocus<HTMLElement>(open, requestClose);

  useEffect(() => {
    if (vault?.provider) {
      setBaseUrl(vault.provider.baseUrl);
      setModel(vault.provider.model);
    }
  }, [vault?.provider]);

  if (!open) {
    return null;
  }

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

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="settings-card"
        data-testid="provider-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-settings-title"
      >
      <div className="settings-card__header">
        <div>
          <h2 id="provider-settings-title">模型与密钥</h2>
          <p>密钥只加密保存在本机，浏览器重启后需要重新解锁。</p>
        </div>
        <button
          type="button"
          className="modal-close"
          aria-label="关闭设置"
          disabled={busy}
          onClick={requestClose}
        >
          ×
        </button>
      </div>
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
            disabled={busy}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button
            type="button"
            className="settings-action"
            disabled={busy}
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
              disabled={busy}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label>
            <span>模型</span>
            <input
              value={model}
              data-testid="provider-model"
              disabled={busy}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          <label>
            <span>API Key</span>
            <input
              type="password"
              value={apiKey}
              placeholder={vault?.status === 'unlocked' ? 'Replace key' : 'sk-…'}
              data-testid="provider-api-key"
              disabled={busy}
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
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="settings-action settings-action--primary"
            disabled={busy}
            data-testid="save-provider"
            onClick={() => void handleConfigure()}
          >
            {busy ? '正在加密…' : '保存并解锁'}
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
                disabled={busy}
                onClick={() => void lock()}
              >
                锁定
              </button>
            )}
            <button
              type="button"
              data-testid="clear-vault"
              disabled={busy}
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
        API Key 使用 AES-GCM 加密；解锁密钥只保留在当前浏览器会话中。
      </p>
      </section>
    </div>
  );
}
