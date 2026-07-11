import { describe, expect, it } from 'vitest';
import {
  describeSiteAccess,
  grantSiteAccess,
  originTargetFor,
  revokeSiteAccess,
  type SiteAccessApi,
} from '../../src/sidepanel/site-access';

function createApi(overrides: Partial<SiteAccessApi> = {}): SiteAccessApi {
  return {
    queryActiveTabUrl: async () => 'https://console.example.com/orders',
    containsOrigins: async () => false,
    requestOrigins: async () => true,
    removeOrigins: async () => true,
    ...overrides,
  };
}

describe('originTargetFor', () => {
  it('builds a requestable https pattern without the port', () => {
    expect(originTargetFor('https://console.example.com:8443/orders')).toEqual({
      host: 'console.example.com:8443',
      pattern: 'https://console.example.com/*',
      requestable: true,
    });
  });

  it('keeps loopback http requestable for local development systems', () => {
    expect(originTargetFor('http://127.0.0.1:4174/customer-create.html')).toEqual(
      {
        host: '127.0.0.1:4174',
        pattern: 'http://127.0.0.1/*',
        requestable: true,
      },
    );
    expect(originTargetFor('http://localhost:5173/')?.requestable).toBe(true);
  });

  it('marks plain http on non-loopback hosts as not requestable', () => {
    expect(originTargetFor('http://intranet.example.com/app')).toEqual({
      host: 'intranet.example.com',
      pattern: 'http://intranet.example.com/*',
      requestable: false,
    });
  });

  it('rejects non-web and malformed urls', () => {
    expect(originTargetFor('chrome://extensions/')).toBeUndefined();
    expect(originTargetFor('about:blank')).toBeUndefined();
    expect(originTargetFor('not a url')).toBeUndefined();
  });
});

describe('describeSiteAccess', () => {
  it('reports a persistent grant for the active origin', async () => {
    const checked: string[][] = [];
    const api = createApi({
      containsOrigins: async (patterns) => {
        checked.push(patterns);
        return true;
      },
    });

    await expect(describeSiteAccess(api)).resolves.toEqual({
      kind: 'persistent',
      host: 'console.example.com',
      pattern: 'https://console.example.com/*',
    });
    expect(checked).toEqual([['https://console.example.com/*']]);
  });

  it('reports temporary access when no persistent grant exists', async () => {
    await expect(describeSiteAccess(createApi())).resolves.toEqual({
      kind: 'temporary',
      host: 'console.example.com',
      pattern: 'https://console.example.com/*',
    });
  });

  it('reports unknown when the tab url is not readable', async () => {
    const api = createApi({ queryActiveTabUrl: async () => undefined });
    await expect(describeSiteAccess(api)).resolves.toEqual({ kind: 'unknown' });
  });

  it('reports unknown when the tab query fails', async () => {
    const api = createApi({
      queryActiveTabUrl: async () => {
        throw new Error('no tabs access');
      },
    });
    await expect(describeSiteAccess(api)).resolves.toEqual({ kind: 'unknown' });
  });

  it('reports unsupported for readable non-web pages', async () => {
    const api = createApi({
      queryActiveTabUrl: async () => 'chrome://settings/',
    });
    await expect(describeSiteAccess(api)).resolves.toEqual({
      kind: 'unsupported',
      url: 'chrome://settings/',
    });
  });

  it('reports unrequestable for plain http intranet hosts', async () => {
    const api = createApi({
      queryActiveTabUrl: async () => 'http://erp.internal/orders',
    });
    await expect(describeSiteAccess(api)).resolves.toEqual({
      kind: 'unrequestable',
      host: 'erp.internal',
    });
  });

  it('falls back to temporary when the permission check fails', async () => {
    const api = createApi({
      containsOrigins: async () => {
        throw new Error('permissions unavailable');
      },
    });
    await expect(describeSiteAccess(api)).resolves.toMatchObject({
      kind: 'temporary',
    });
  });
});

describe('grantSiteAccess', () => {
  it('grants when the user accepts the browser prompt', async () => {
    const requested: string[][] = [];
    const api = createApi({
      requestOrigins: async (patterns) => {
        requested.push(patterns);
        return true;
      },
    });

    await expect(
      grantSiteAccess(api, 'https://console.example.com/*'),
    ).resolves.toEqual({ granted: true });
    expect(requested).toEqual([['https://console.example.com/*']]);
  });

  it('reports a declined prompt without changing state', async () => {
    const api = createApi({ requestOrigins: async () => false });

    const outcome = await grantSiteAccess(api, 'https://console.example.com/*');
    expect(outcome.granted).toBe(false);
    if (!outcome.granted) {
      expect(outcome.reason).toBe('declined');
      expect(outcome.message).toContain('拒绝');
    }
  });

  it('surfaces request errors such as a lost user gesture', async () => {
    const api = createApi({
      requestOrigins: async () => {
        throw new Error('This function must be called during a user gesture');
      },
    });

    const outcome = await grantSiteAccess(api, 'https://console.example.com/*');
    expect(outcome.granted).toBe(false);
    if (!outcome.granted) {
      expect(outcome.reason).toBe('error');
      expect(outcome.message).toContain('user gesture');
    }
  });
});

describe('revokeSiteAccess', () => {
  it('revokes an optional grant', async () => {
    await expect(
      revokeSiteAccess(createApi(), 'https://console.example.com/*'),
    ).resolves.toEqual({ revoked: true });
  });

  it('re-checks and reports still granted when removal is refused', async () => {
    const api = createApi({
      removeOrigins: async () => {
        throw new Error('You cannot remove required permissions.');
      },
      containsOrigins: async () => true,
    });

    const outcome = await revokeSiteAccess(
      api,
      'http://127.0.0.1/*',
    );
    expect(outcome.revoked).toBe(false);
    if (!outcome.revoked) {
      expect(outcome.stillGranted).toBe(true);
      expect(outcome.message).toContain('仍保持已授权');
    }
  });

  it('reports an uncertain result when removal fails and the grant vanished', async () => {
    const api = createApi({
      removeOrigins: async () => false,
      containsOrigins: async () => false,
    });

    const outcome = await revokeSiteAccess(
      api,
      'https://console.example.com/*',
    );
    expect(outcome.revoked).toBe(false);
    if (!outcome.revoked) {
      expect(outcome.stillGranted).toBe(false);
      expect(outcome.message).toContain('不确定');
    }
  });
});
