import {
  revokeSiteAccess,
  type RevokeOutcome,
  type SiteAccessApi,
} from '../sidepanel/site-access';

export interface GrantedSitesApi extends SiteAccessApi {
  getAllOriginPatterns(): Promise<string[]>;
}

export interface GrantedSite {
  pattern: string;
  host: string;
  matchesAllSites: boolean;
}

const ALL_URL_PATTERNS = new Set(['<all_urls>', '*://*/*']);

function describePattern(pattern: string): GrantedSite {
  if (ALL_URL_PATTERNS.has(pattern)) {
    return { pattern, host: pattern, matchesAllSites: true };
  }
  const match = /^(?:https?|\*):\/\/([^/]+)\/.*$/.exec(pattern);
  return {
    pattern,
    host: match?.[1] ?? pattern,
    matchesAllSites: match?.[1] === '*',
  };
}

export async function listGrantedSites(
  api: Pick<GrantedSitesApi, 'getAllOriginPatterns'>,
): Promise<GrantedSite[]> {
  const patterns = await api.getAllOriginPatterns();
  return Array.from(new Set(patterns))
    .map(describePattern)
    .sort((a, b) => a.host.localeCompare(b.host));
}

export function providerOriginPatternFor(
  baseUrl: string | undefined,
): string | undefined {
  if (!baseUrl) {
    return undefined;
  }
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return undefined;
  }
}

export type { RevokeOutcome };

export function revokeGrantedSite(
  api: SiteAccessApi,
  pattern: string,
): Promise<RevokeOutcome> {
  return revokeSiteAccess(api, pattern);
}
