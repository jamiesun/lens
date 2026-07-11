import { defineConfig } from 'wxt';

const devTestUrl = process.env.LENS_DEV_TEST_URL;

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  webExt: devTestUrl
    ? {
        startUrls: [devTestUrl],
      }
    : undefined,
  manifest: ({ mode }) => ({
    name: 'Lens',
    description: 'Local-first frontend agent runtime for your own systems',
    minimum_chrome_version: '116',
    permissions: ['activeTab', 'scripting', 'storage'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: {
      default_title: 'Open Lens',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
      },
    },
    ...(mode === 'test'
      ? {
          host_permissions: ['http://127.0.0.1/*'],
        }
      : mode === 'e2e'
        ? {
            // Headless Chromium cannot click the browser toolbar to grant
            // activeTab. This permission exists only in the E2E artifact.
            host_permissions: ['<all_urls>'],
          }
      : {}),
  }),
});
