import { useEffect, useState } from 'react';
import { ProviderConfigSchema } from '../../src/protocol/provider';
import { useAgentStore } from '../../src/sidepanel/agent-store';

export function ProviderSettings({ open }: { open: boolean }) {
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
    const saved = await configure(parsed.data, apiKey, password);
    if (saved) {
      setApiKey('');
      setPassword('');
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
    }
  };

  return (
    <section className="settings-card" data-testid="provider-settings">
      <div className="settings-card__header">
        <div>
          <p className="section-index">00 / PROVIDER</p>
          <h2>Local credential vault</h2>
        </div>
        <span
          className={`vault-state vault-state--${vault?.status ?? 'loading'}`}
          data-testid="vault-status"
        >
          {vault?.status ?? 'loading'}
        </span>
      </div>

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
            <span>BASE URL</span>
            <input
              value={baseUrl}
              data-testid="provider-base-url"
              disabled={busy}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
          <label>
            <span>MODEL</span>
            <input
              value={model}
              data-testid="provider-model"
              disabled={busy}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          <label>
            <span>API KEY</span>
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
            <span>MASTER PASSWORD</span>
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
            {busy ? 'ENCRYPTING' : 'SAVE + UNLOCK'}
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
                LOCK
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
              {confirmClear ? 'CONFIRM CLEAR' : 'CLEAR'}
            </button>
          </div>
        </div>
      )}

      <p className="settings-note">
        API key: AES-GCM encrypted in local storage. Unlock key: session memory
        only. HTTPS or loopback providers only.
      </p>
    </section>
  );
}
