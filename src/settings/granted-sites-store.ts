import { create } from 'zustand';
import { browser } from 'wxt/browser';
import {
  listGrantedSites,
  revokeGrantedSite,
  type GrantedSite,
  type GrantedSitesApi,
} from './granted-sites';

function createBrowserGrantedSitesApi(): GrantedSitesApi {
  return {
    async getAllOriginPatterns() {
      const all = await browser.permissions.getAll();
      return all.origins ?? [];
    },
    async queryActiveTabUrl() {
      return undefined;
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

const api = createBrowserGrantedSitesApi();

interface GrantedSitesState {
  loaded: boolean;
  sites: GrantedSite[];
  busy: boolean;
  notice?: string;
  error?: string;
  refresh: () => Promise<void>;
  revoke: (pattern: string) => Promise<void>;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useGrantedSitesStore = create<GrantedSitesState>((set, get) => ({
  loaded: false,
  sites: [],
  busy: false,

  async refresh() {
    try {
      const sites = await listGrantedSites(api);
      set({ loaded: true, sites, error: undefined });
    } catch (error) {
      set({ loaded: true, error: describeError(error) });
    }
  },

  async revoke(pattern) {
    if (get().busy) {
      return;
    }
    set({ busy: true, notice: undefined, error: undefined });
    const outcome = await revokeGrantedSite(api, pattern);
    let sites = get().sites;
    let error: string | undefined;
    try {
      sites = await listGrantedSites(api);
    } catch (refreshError) {
      error = describeError(refreshError);
    }
    set({
      busy: false,
      sites,
      error,
      notice: outcome.revoked
        ? `已撤销 ${pattern} 的长期授权。`
        : outcome.message,
    });
  },
}));
