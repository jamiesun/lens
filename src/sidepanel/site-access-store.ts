import { create } from 'zustand';
import { browser } from 'wxt/browser';
import {
  describeSiteAccess,
  grantSiteAccess,
  revokeSiteAccess,
  type SiteAccess,
  type SiteAccessApi,
} from './site-access';
import { useObserverStore } from './observer-store';

function createBrowserSiteAccessApi(): SiteAccessApi {
  return {
    async queryActiveTabUrl() {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      return tab?.url;
    },
    containsOrigins(origins) {
      return browser.permissions.contains({ origins });
    },
    requestOrigins(origins) {
      return browser.permissions.request({ origins });
    },
    removeOrigins(origins) {
      return browser.permissions.remove({ origins });
    },
  };
}

const api = createBrowserSiteAccessApi();

interface SiteAccessState {
  access: SiteAccess;
  busy: boolean;
  notice?: string;
  refresh: () => Promise<void>;
  grant: () => Promise<void>;
  revoke: () => Promise<void>;
}

export const useSiteAccessStore = create<SiteAccessState>((set, get) => ({
  access: { kind: 'unknown' },
  busy: false,

  async refresh() {
    const access = await describeSiteAccess(api);
    set({ access });
  },

  async grant() {
    const { access, busy } = get();
    if (busy || access.kind !== 'temporary') {
      return;
    }

    set({ busy: true, notice: undefined });
    // First async call in the click path so the user gesture survives.
    const outcome = await grantSiteAccess(api, access.pattern);
    const refreshed = await describeSiteAccess(api);
    set({
      busy: false,
      access: refreshed,
      notice: outcome.granted ? undefined : outcome.message,
    });

    if (outcome.granted) {
      const observer = useObserverStore.getState();
      if (observer.phase === 'error' || observer.phase === 'idle') {
        void observer.scanPage();
      }
    }
  },

  async revoke() {
    const { access, busy } = get();
    if (busy || access.kind !== 'persistent') {
      return;
    }

    set({ busy: true, notice: undefined });
    const outcome = await revokeSiteAccess(api, access.pattern);
    const refreshed = await describeSiteAccess(api);
    set({
      busy: false,
      access: refreshed,
      notice: outcome.revoked
        ? '已取消长期授权。之后需要点击工具栏图标临时授权。'
        : outcome.message,
    });
  },
}));
