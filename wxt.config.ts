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
    optional_host_permissions: [
      'https://*/*',
      'http://127.0.0.1/*',
      'http://localhost/*',
    ],
    action: {
      default_title: 'Open Lens',
    },
    ...(mode === 'test'
      ? {
          host_permissions: ['http://127.0.0.1/*'],
        }
      : {}),
  }),
});
