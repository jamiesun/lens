import { describe, expect, it, vi } from 'vitest';
import {
  handleRuntimeRequest,
  type SnapshotDependencies,
} from '../../src/background/snapshot-service';
import type { PageSnapshot } from '../../src/protocol/page-snapshot';

const snapshot: PageSnapshot = {
  version: 1,
  snapshotId: 'snapshot_1',
  generation: 1,
  capturedAt: '2026-07-10T14:00:00.000Z',
  url: 'https://app.example.test/customers',
  title: 'Customers',
  route: '/customers',
  headings: [],
  forms: [],
  tables: [],
  actions: [],
  alerts: [],
};

function createDependencies(
  overrides: Partial<SnapshotDependencies> = {},
): SnapshotDependencies {
  return {
    getActiveTab: vi.fn().mockResolvedValue({
      id: 42,
      url: 'https://app.example.test/customers',
    }),
    executeSnapshot: vi.fn().mockResolvedValue(snapshot),
    ...overrides,
  };
}

describe('handleRuntimeRequest', () => {
  it('returns a validated snapshot for a valid request', async () => {
    const response = await handleRuntimeRequest(
      {
        type: 'lens.page.snapshot.request',
        requestId: 'request-1',
      },
      createDependencies(),
    );

    expect(response).toEqual({
      type: 'lens.page.snapshot.response',
      requestId: 'request-1',
      ok: true,
      snapshot,
    });
  });

  it('rejects malformed runtime messages', async () => {
    const dependencies = createDependencies();
    const response = await handleRuntimeRequest(
      {
        type: 'lens.page.snapshot.request',
      },
      dependencies,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
      },
    });
    expect(dependencies.executeSnapshot).not.toHaveBeenCalled();
  });

  it('rejects unsupported browser surfaces before script execution', async () => {
    const dependencies = createDependencies({
      getActiveTab: vi.fn().mockResolvedValue({
        id: 9,
        url: 'chrome://extensions',
      }),
    });
    const response = await handleRuntimeRequest(
      {
        type: 'lens.page.snapshot.request',
        requestId: 'request-2',
      },
      dependencies,
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'UNSUPPORTED_PAGE',
      },
    });
    expect(dependencies.executeSnapshot).not.toHaveBeenCalled();
  });

  it('reports denied host access without returning a success-shaped fallback', async () => {
    const response = await handleRuntimeRequest(
      {
        type: 'lens.page.snapshot.request',
        requestId: 'request-3',
      },
      createDependencies({
        executeSnapshot: vi
          .fn()
          .mockRejectedValue(
            new Error('Cannot access contents of url. Missing host permission.'),
          ),
      }),
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'PAGE_ACCESS_DENIED',
      },
    });
  });

  it('resolves with a failure response when tab lookup itself rejects', async () => {
    const response = await handleRuntimeRequest(
      {
        type: 'lens.page.snapshot.request',
        requestId: 'request-4',
      },
      createDependencies({
        getActiveTab: vi
          .fn()
          .mockRejectedValue(new Error('tabs API unavailable')),
      }),
    );

    expect(response).toMatchObject({
      ok: false,
      requestId: 'request-4',
      error: {
        code: 'SNAPSHOT_FAILED',
      },
    });
  });
});
