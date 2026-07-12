import { describe, expect, it } from 'vitest';
import {
  listGrantedSites,
  providerOriginPatternFor,
  revokeGrantedSite,
  type GrantedSitesApi,
} from '../../src/settings/granted-sites';

function createApi(overrides: Partial<GrantedSitesApi> = {}): GrantedSitesApi {
  return {
    getAllOriginPatterns: async () => [],
    queryActiveTabUrl: async () => undefined,
    containsOrigins: async () => false,
    requestOrigins: async () => true,
    removeOrigins: async () => true,
    ...overrides,
  };
}

describe('listGrantedSites', () => {
  it('returns an empty list when nothing is granted', async () => {
    expect(await listGrantedSites(createApi())).toEqual([]);
  });

  it('deduplicates, extracts hosts, and sorts by host', async () => {
    const sites = await listGrantedSites(
      createApi({
        getAllOriginPatterns: async () => [
          'https://zeta.example.com/*',
          'http://127.0.0.1/*',
          'https://zeta.example.com/*',
        ],
      }),
    );
    expect(sites).toEqual([
      {
        pattern: 'http://127.0.0.1/*',
        host: '127.0.0.1',
        matchesAllSites: false,
      },
      {
        pattern: 'https://zeta.example.com/*',
        host: 'zeta.example.com',
        matchesAllSites: false,
      },
    ]);
  });

  it('labels install-time match-all patterns honestly', async () => {
    const sites = await listGrantedSites(
      createApi({
        getAllOriginPatterns: async () => [
          '<all_urls>',
          '*://*/*',
          'https://*/*',
        ],
      }),
    );
    expect(sites.map((site) => site.matchesAllSites)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it('propagates permission read failures instead of faking an empty list', async () => {
    await expect(
      listGrantedSites(
        createApi({
          getAllOriginPatterns: async () => {
            throw new Error('permissions unavailable');
          },
        }),
      ),
    ).rejects.toThrow('permissions unavailable');
  });
});

describe('providerOriginPatternFor', () => {
  it('mirrors the provider permission pattern', () => {
    expect(providerOriginPatternFor('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/*',
    );
    expect(providerOriginPatternFor('http://127.0.0.1:4174/v1/')).toBe(
      'http://127.0.0.1/*',
    );
  });

  it('returns undefined without a valid provider', () => {
    expect(providerOriginPatternFor(undefined)).toBeUndefined();
    expect(providerOriginPatternFor('not a url')).toBeUndefined();
  });
});

describe('revokeGrantedSite', () => {
  it('revokes a removable grant', async () => {
    const removed: string[][] = [];
    const outcome = await revokeGrantedSite(
      createApi({
        removeOrigins: async (patterns) => {
          removed.push(patterns);
          return true;
        },
      }),
      'https://zeta.example.com/*',
    );
    expect(outcome).toEqual({ revoked: true });
    expect(removed).toEqual([['https://zeta.example.com/*']]);
  });

  it('re-checks the real state when the browser refuses', async () => {
    const outcome = await revokeGrantedSite(
      createApi({
        removeOrigins: async () => false,
        containsOrigins: async () => true,
      }),
      '<all_urls>',
    );
    expect(outcome).toMatchObject({ revoked: false, stillGranted: true });
    if (!outcome.revoked) {
      expect(outcome.message).toContain('仍保持已授权状态');
    }
  });
});
