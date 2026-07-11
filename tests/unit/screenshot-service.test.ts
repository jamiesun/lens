import { describe, expect, it, vi } from 'vitest';
import {
  captureScreenshot,
  createScrollPositions,
  handleScreenshotRequest,
  type ScreenshotDependencies,
} from '../../src/background/screenshot-service';

describe('createScrollPositions', () => {
  it('covers a full document without duplicating the final viewport', () => {
    expect(createScrollPositions(2_200, 800, 2_200)).toEqual([
      0,
      800,
      1_400,
    ]);
  });

  it('caps a truncated long capture to the requested segment budget', () => {
    const positions = createScrollPositions(50_000, 800, 16_000);

    expect(positions).toHaveLength(20);
    expect(positions[0]).toBe(0);
    expect(positions.at(-1)).toBe(15_200);
  });

  it('clamps truncated offsets to the actual maximum scroll position', () => {
    const positions = createScrollPositions(16_001, 1_200, 16_000);

    expect(positions.at(-1)).toBe(14_801);
    expect(new Set(positions).size).toBe(positions.length);
  });
});

describe('screenshot identity and cancellation', () => {
  it('discards a viewport capture when the same tab navigates', async () => {
    const tabs = [
      { id: 4, windowId: 2, url: 'https://example.test/first' },
      { id: 4, windowId: 2, url: 'https://example.test/first' },
      { id: 4, windowId: 2, url: 'https://example.test/second' },
    ];
    const dependencies: ScreenshotDependencies = {
      getActiveTab: vi.fn().mockImplementation(async () => tabs.shift()),
      ensurePageAgent: vi.fn().mockResolvedValue(undefined),
      sendPageCommand: vi.fn().mockResolvedValue({
        documentId: 'document-1',
      }),
      captureVisibleTab: vi
        .fn()
        .mockResolvedValue('data:image/png;base64,AA=='),
      wait: vi.fn().mockResolvedValue(undefined),
    };

    const response = await handleScreenshotRequest(
      {
        type: 'lens.page.screenshot.request',
        requestId: 'navigation-test',
        mode: 'viewport',
      },
      dependencies,
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: 'PAGE_CHANGED' },
    });
  });

  it('restores the page when a full capture is cancelled mid-wait', async () => {
    const controller = new AbortController();
    const sendPageCommand = vi.fn().mockImplementation(async (_tabId, command) => {
      switch (command.command) {
        case 'page.screenshot.prepare':
          return {
            ok: true,
            sessionId: command.payload.sessionId,
            documentWidth: 800,
            documentHeight: 2_400,
            viewportWidth: 800,
            viewportHeight: 800,
          };
        case 'page.screenshot.scroll':
          return { ok: true, scrollY: command.payload.y };
        case 'page.screenshot.restore':
          return { ok: true };
        default:
          return { documentId: 'document-1' };
      }
    });
    const dependencies: ScreenshotDependencies = {
      getActiveTab: vi.fn().mockResolvedValue({
        id: 4,
        windowId: 2,
        url: 'https://example.test/page',
      }),
      ensurePageAgent: vi.fn().mockResolvedValue(undefined),
      sendPageCommand,
      captureVisibleTab: vi.fn(),
      wait: vi.fn().mockImplementation(async () => {
        controller.abort();
      }),
    };

    await expect(
      captureScreenshot(
        { id: 4, windowId: 2, url: 'https://example.test/page' },
        'full-page',
        dependencies,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(sendPageCommand).toHaveBeenCalledWith(4, {
      source: 'lens-background',
      command: 'page.screenshot.restore',
      payload: { sessionId: expect.any(String) },
    });
  });
});
