import { describe, expect, it, vi } from 'vitest';
import {
  handleRuntimeRequest,
  type PageServiceDependencies,
} from '../../src/background/page-service';
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
  overrides: Partial<PageServiceDependencies> = {},
): PageServiceDependencies {
  return {
    getActiveTab: vi.fn().mockResolvedValue({
      id: 42,
      url: 'https://app.example.test/customers',
    }),
    ensurePageAgent: vi.fn().mockResolvedValue(undefined),
    sendPageCommand: vi.fn().mockResolvedValue(snapshot),
    ...overrides,
  };
}

const snapshotRequest = {
  type: 'lens.page.snapshot.request',
  requestId: 'request-1',
};

const fillRequest = {
  type: 'lens.page.fill.request',
  requestId: 'request-2',
  snapshotId: 'snapshot_1',
  generation: 1,
  fields: [{ nodeId: 'node_1_001', value: 'Grace' }],
};

describe('handleRuntimeRequest', () => {
  it('returns a validated snapshot for a valid request', async () => {
    const dependencies = createDependencies();
    const response = await handleRuntimeRequest(snapshotRequest, dependencies);

    expect(response).toEqual({
      type: 'lens.page.snapshot.response',
      requestId: 'request-1',
      ok: true,
      snapshot,
    });
    expect(dependencies.ensurePageAgent).toHaveBeenCalledWith(42);
    expect(dependencies.sendPageCommand).toHaveBeenCalledWith(42, {
      source: 'lens-background',
      command: 'page.snapshot',
    });
  });

  it('rejects malformed runtime messages with the matching response type', async () => {
    const dependencies = createDependencies();
    const snapshotShaped = await handleRuntimeRequest(
      { type: 'lens.page.snapshot.request' },
      dependencies,
    );
    const fillShaped = await handleRuntimeRequest(
      { type: 'lens.page.fill.request', requestId: 'r', fields: [] },
      dependencies,
    );

    expect(snapshotShaped).toMatchObject({
      type: 'lens.page.snapshot.response',
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(fillShaped).toMatchObject({
      type: 'lens.page.fill.response',
      ok: false,
      error: { code: 'INVALID_REQUEST' },
    });
    expect(dependencies.sendPageCommand).not.toHaveBeenCalled();
  });

  it('rejects unsupported browser surfaces before attaching the agent', async () => {
    const dependencies = createDependencies({
      getActiveTab: vi.fn().mockResolvedValue({
        id: 9,
        url: 'chrome://extensions',
      }),
    });
    const response = await handleRuntimeRequest(snapshotRequest, dependencies);

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'UNSUPPORTED_PAGE' },
    });
    expect(dependencies.ensurePageAgent).not.toHaveBeenCalled();
  });

  it('maps denied host access from agent installation', async () => {
    const response = await handleRuntimeRequest(
      snapshotRequest,
      createDependencies({
        ensurePageAgent: vi
          .fn()
          .mockRejectedValue(
            new Error('Cannot access contents of url. Missing host permission.'),
          ),
      }),
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'PAGE_ACCESS_DENIED' },
    });
  });

  it('resolves with a failure response when tab lookup itself rejects', async () => {
    const response = await handleRuntimeRequest(
      snapshotRequest,
      createDependencies({
        getActiveTab: vi
          .fn()
          .mockRejectedValue(new Error('tabs API unavailable')),
      }),
    );

    expect(response).toMatchObject({
      ok: false,
      requestId: 'request-1',
      error: { code: 'SNAPSHOT_FAILED' },
    });
  });

  it('returns per-field outcomes for a successful fill', async () => {
    const fillResult = {
      ok: true,
      result: {
        snapshotId: 'snapshot_1',
        generation: 1,
        outcomes: [{ nodeId: 'node_1_001', status: 'filled' }],
      },
    };
    const dependencies = createDependencies({
      sendPageCommand: vi.fn().mockResolvedValue(fillResult),
    });

    const response = await handleRuntimeRequest(fillRequest, dependencies);

    expect(response).toEqual({
      type: 'lens.page.fill.response',
      requestId: 'request-2',
      ok: true,
      result: fillResult.result,
    });
    expect(dependencies.sendPageCommand).toHaveBeenCalledWith(42, {
      source: 'lens-background',
      command: 'page.form.fill',
      payload: {
        snapshotId: 'snapshot_1',
        generation: 1,
        fields: [{ nodeId: 'node_1_001', value: 'Grace' }],
      },
    });
  });

  it('maps stale page results to STALE_SNAPSHOT failures', async () => {
    const response = await handleRuntimeRequest(
      fillRequest,
      createDependencies({
        sendPageCommand: vi.fn().mockResolvedValue({
          ok: false,
          code: 'STALE_SNAPSHOT',
          message: 'The page changed since this snapshot was taken.',
        }),
      }),
    );

    expect(response).toMatchObject({
      type: 'lens.page.fill.response',
      ok: false,
      error: { code: 'STALE_SNAPSHOT' },
    });
  });

  it('rejects malformed fill results from the page', async () => {
    const response = await handleRuntimeRequest(
      fillRequest,
      createDependencies({
        sendPageCommand: vi.fn().mockResolvedValue({
          ok: true,
          result: { outcomes: 'garbage' },
        }),
      }),
    );

    expect(response).toMatchObject({
      type: 'lens.page.fill.response',
      ok: false,
      error: { code: 'FILL_FAILED' },
    });
  });
});
