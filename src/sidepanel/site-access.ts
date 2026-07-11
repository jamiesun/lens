export interface SiteAccessApi {
  queryActiveTabUrl(): Promise<string | undefined>;
  containsOrigins(patterns: string[]): Promise<boolean>;
  requestOrigins(patterns: string[]): Promise<boolean>;
  removeOrigins(patterns: string[]): Promise<boolean>;
}

/**
 * Site access states for the active tab.
 *
 * - `unknown`: the tab URL is not readable, which means neither activeTab nor
 *   a persistent host permission is armed for the page.
 * - `unsupported`: the URL is readable but is not an HTTP(S) page.
 * - `unrequestable`: readable HTTP page outside the optional host permission
 *   allowlist (plain HTTP on a non-loopback host), so only activeTab works.
 * - `temporary`: readable via activeTab only; a persistent grant is possible.
 * - `persistent`: the origin holds a persistent host permission.
 */
export type SiteAccess =
  | { kind: 'unknown' }
  | { kind: 'unsupported'; url: string }
  | { kind: 'unrequestable'; host: string }
  | { kind: 'temporary'; host: string; pattern: string }
  | { kind: 'persistent'; host: string; pattern: string };

export interface OriginTarget {
  host: string;
  pattern: string;
  requestable: boolean;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Builds the host permission pattern for a page URL. Match patterns ignore
 * ports, so the pattern is protocol + hostname. Only patterns inside the
 * manifest `optional_host_permissions` allowlist are requestable: any HTTPS
 * origin, or loopback HTTP for local development systems.
 */
export function originTargetFor(url: string): OriginTarget | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return undefined;
  }

  const requestable =
    parsed.protocol === 'https:' || LOOPBACK_HOSTS.has(parsed.hostname);

  return {
    host: parsed.host,
    pattern: `${parsed.protocol}//${parsed.hostname}/*`,
    requestable,
  };
}

export async function describeSiteAccess(
  api: SiteAccessApi,
): Promise<SiteAccess> {
  let url: string | undefined;
  try {
    url = await api.queryActiveTabUrl();
  } catch {
    return { kind: 'unknown' };
  }

  if (!url) {
    return { kind: 'unknown' };
  }

  const target = originTargetFor(url);
  if (!target) {
    return { kind: 'unsupported', url };
  }

  if (!target.requestable) {
    return { kind: 'unrequestable', host: target.host };
  }

  let persistent = false;
  try {
    persistent = await api.containsOrigins([target.pattern]);
  } catch {
    persistent = false;
  }

  return persistent
    ? { kind: 'persistent', host: target.host, pattern: target.pattern }
    : { kind: 'temporary', host: target.host, pattern: target.pattern };
}

export type GrantOutcome =
  | { granted: true }
  | { granted: false; reason: 'declined' | 'error'; message: string };

/**
 * Requests a persistent grant. Callers must invoke this as the first async
 * operation of a click handler so Chrome preserves the user gesture.
 */
export async function grantSiteAccess(
  api: SiteAccessApi,
  pattern: string,
): Promise<GrantOutcome> {
  let granted = false;
  try {
    granted = await api.requestOrigins([pattern]);
  } catch (error) {
    return {
      granted: false,
      reason: 'error',
      message: `长期授权请求失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!granted) {
    return {
      granted: false,
      reason: 'declined',
      message: '你拒绝了长期授权，本次仍可通过工具栏图标临时访问。',
    };
  }

  return { granted: true };
}

export type RevokeOutcome =
  | { revoked: true }
  | { revoked: false; stillGranted: boolean; message: string };

/**
 * Removes a persistent grant. If the browser refuses (for example the origin
 * is covered by a required manifest permission), the real permission state is
 * re-checked so the UI never claims a revocation that did not happen.
 */
export async function revokeSiteAccess(
  api: SiteAccessApi,
  pattern: string,
): Promise<RevokeOutcome> {
  let removed = false;
  let failure: string | undefined;
  try {
    removed = await api.removeOrigins([pattern]);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  if (removed) {
    return { revoked: true };
  }

  let stillGranted = true;
  try {
    stillGranted = await api.containsOrigins([pattern]);
  } catch {
    stillGranted = true;
  }

  return {
    revoked: false,
    stillGranted,
    message: stillGranted
      ? `未能取消长期授权，站点仍保持已授权状态。${failure ?? ''}`.trim()
      : '取消授权的结果不确定，请在浏览器扩展设置中确认。',
  };
}
