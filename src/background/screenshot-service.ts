import {
  DocumentIdentityResultSchema,
  ScreenshotPrepareResultSchema,
  ScreenshotRestoreResultSchema,
  ScreenshotScrollResultSchema,
  type PageCommand,
} from '../protocol/page-commands';
import {
  ScreenshotRequestSchema,
  ScreenshotResultSchema,
  type ScreenshotMode,
  type ScreenshotResponse,
  type ScreenshotResult,
} from '../protocol/screenshot';

const MAX_CAPTURE_HEIGHT = 16_000;
const MAX_CAPTURE_SEGMENTS = 20;
const MAX_OUTPUT_PIXELS = 24_000_000;
const MAX_OUTPUT_BYTES = 6_000_000;
const CAPTURE_INTERVAL_MS = 600;
let lastCaptureAt = 0;

export interface ScreenshotTab {
  id?: number;
  windowId?: number;
  url?: string;
}

export interface ScreenshotDependencies {
  getActiveTab: () => Promise<ScreenshotTab | undefined>;
  ensurePageAgent: (tabId: number) => Promise<void>;
  sendPageCommand: (tabId: number, command: PageCommand) => Promise<unknown>;
  captureVisibleTab: (
    windowId: number,
    options: { format: 'png' | 'jpeg'; quality?: number },
  ) => Promise<string>;
  wait?: (milliseconds: number) => Promise<void>;
}

interface CaptureSegment {
  scrollY: number;
  dataUrl: string;
}

function describeError(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 500)
    : String(error).slice(0, 500);
}

function failure(
  requestId: string,
  code:
    | 'INVALID_REQUEST'
    | 'NO_ACTIVE_TAB'
    | 'UNSUPPORTED_PAGE'
    | 'PAGE_ACCESS_DENIED'
    | 'CAPTURE_FAILED'
    | 'CAPTURE_TOO_LARGE'
    | 'PAGE_CHANGED',
  message: string,
  details?: string,
): ScreenshotResponse {
  return {
    type: 'lens.page.screenshot.response',
    requestId,
    ok: false,
    error: { code, message, details },
  };
}

export async function handleScreenshotRequest(
  message: unknown,
  dependencies: ScreenshotDependencies,
  signal?: AbortSignal,
): Promise<ScreenshotResponse> {
  const parsed = ScreenshotRequestSchema.safeParse(message);
  if (!parsed.success) {
    return failure(
      readRequestId(message),
      'INVALID_REQUEST',
      'The screenshot request did not match the Lens protocol.',
    );
  }

  let tab: ScreenshotTab | undefined;
  try {
    tab = await dependencies.getActiveTab();
  } catch (error) {
    return failure(
      parsed.data.requestId,
      'CAPTURE_FAILED',
      'Lens could not inspect the active browser tab.',
      describeError(error),
    );
  }

  if (typeof tab?.id !== 'number' || typeof tab.windowId !== 'number') {
    return failure(
      parsed.data.requestId,
      'NO_ACTIVE_TAB',
      'Lens could not find an active browser tab.',
    );
  }
  if (tab.url && !/^https?:\/\//i.test(tab.url)) {
    return failure(
      parsed.data.requestId,
      'UNSUPPORTED_PAGE',
      'Lens only captures regular HTTP and HTTPS pages.',
    );
  }

  try {
    const screenshot = await captureScreenshot(
      {
        id: tab.id,
        windowId: tab.windowId,
        url: tab.url,
      },
      parsed.data.mode,
      dependencies,
      signal,
    );
    return {
      type: 'lens.page.screenshot.response',
      requestId: parsed.data.requestId,
      ok: true,
      screenshot,
    };
  } catch (error) {
    const details = describeError(error);
    const code = /permission|cannot access|cannot be scripted/i.test(details)
      ? 'PAGE_ACCESS_DENIED'
      : /too large|size limit|1 MiB|6 MiB/i.test(details)
        ? 'CAPTURE_TOO_LARGE'
        : /page changed|stale capture/i.test(details)
          ? 'PAGE_CHANGED'
          : 'CAPTURE_FAILED';
    return failure(
      parsed.data.requestId,
      code,
      code === 'CAPTURE_TOO_LARGE'
        ? 'The screenshot exceeded Lens capture limits.'
        : code === 'PAGE_CHANGED'
          ? 'The page changed while Lens was capturing it.'
          : 'Lens could not capture the active page.',
      details,
    );
  }
}

export async function captureScreenshot(
  expectedTab: Required<Pick<ScreenshotTab, 'id' | 'windowId'>> &
    Pick<ScreenshotTab, 'url'>,
  mode: ScreenshotMode,
  dependencies: ScreenshotDependencies,
  signal?: AbortSignal,
): Promise<ScreenshotResult> {
  const tabId = expectedTab.id;
  const windowId = expectedTab.windowId;
  const wait =
    dependencies.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  if (mode === 'viewport') {
    throwIfAborted(signal);
    await withTimeout(
      dependencies.ensurePageAgent(tabId),
      2_000,
      signal,
      'Page agent attachment timed out.',
    );
    const identity = DocumentIdentityResultSchema.parse(
      await sendPageCommandBounded(
        dependencies,
        tabId,
        {
          source: 'lens-background',
          command: 'page.document.identity',
        },
        signal,
      ),
    );
    const dataUrl = await captureWithRateLimit(
      dependencies,
      expectedTab,
      { format: 'png' },
      wait,
      signal,
    );
    const identityAfter = DocumentIdentityResultSchema.parse(
      await sendPageCommandBounded(
        dependencies,
        tabId,
        {
          source: 'lens-background',
          command: 'page.document.identity',
        },
        signal,
      ),
    );
    if (identityAfter.documentId !== identity.documentId) {
      throw new Error('The page document changed during screenshot capture.');
    }
    const bitmap = await decodeDataUrl(dataUrl);
    try {
      return ScreenshotResultSchema.parse({
        dataUrl,
        filename: timestampedFilename('viewport', 'png'),
        mimeType: 'image/png',
        width: bitmap.width,
        height: bitmap.height,
        mode,
        truncated: false,
      });
    } finally {
      bitmap.close();
    }
  }

  await withTimeout(
    dependencies.ensurePageAgent(tabId),
    2_000,
    signal,
    'Page agent attachment timed out.',
  );
  throwIfAborted(signal);
  const captureSessionId = crypto.randomUUID();
  const prepareOperation = dependencies.sendPageCommand(tabId, {
    source: 'lens-background',
    command: 'page.screenshot.prepare',
    payload: { sessionId: captureSessionId },
  });
  const rawPrepared = await withPrepareCleanup(
    prepareOperation,
    dependencies,
    tabId,
    captureSessionId,
    signal,
  );
  let prepared: ReturnType<typeof ScreenshotPrepareResultSchema.parse>;
  try {
    prepared = ScreenshotPrepareResultSchema.parse(rawPrepared);
  } catch (error) {
    const sessionId =
      typeof rawPrepared === 'object' &&
      rawPrepared !== null &&
      'sessionId' in rawPrepared &&
      typeof rawPrepared.sessionId === 'string'
        ? rawPrepared.sessionId
        : undefined;
    if (sessionId) {
      await sendPageCommandBounded(
        dependencies,
        tabId,
        {
          source: 'lens-background',
          command: 'page.screenshot.restore',
          payload: { sessionId },
        },
        undefined,
      )
        .catch(() => undefined);
    }
    throw error;
  }
  const captureHeight = Math.min(
    prepared.documentHeight,
    MAX_CAPTURE_HEIGHT,
    prepared.viewportHeight * MAX_CAPTURE_SEGMENTS,
  );
  const positions = createScrollPositions(
    prepared.documentHeight,
    prepared.viewportHeight,
    captureHeight,
  );
  const segments: CaptureSegment[] = [];
  let captureError: unknown;
  let restoreError: unknown;

  try {
    for (const [index, position] of positions.entries()) {
      throwIfAborted(signal);
      const activeTab = await dependencies.getActiveTab();
      if (!sameTab(activeTab, expectedTab)) {
        throw new Error('The active page changed during screenshot capture.');
      }
      const scrolled = ScreenshotScrollResultSchema.parse(
        await sendPageCommandBounded(
          dependencies,
          tabId,
          {
          source: 'lens-background',
          command: 'page.screenshot.scroll',
          payload: {
            sessionId: prepared.sessionId,
            y: position,
            hideFixed: index > 0,
          },
          },
          signal,
        ),
      );
      if (Math.abs(scrolled.scrollY - position) > 2) {
        throw new Error(
          `Page did not reach requested screenshot offset ${position}; received ${scrolled.scrollY}.`,
        );
      }
      await abortableWait(100, wait, signal);
      if (segments.some((segment) => segment.scrollY === scrolled.scrollY)) {
        continue;
      }
      segments.push({
        scrollY: scrolled.scrollY,
        dataUrl: await captureWithRateLimit(
          dependencies,
          expectedTab,
          { format: 'jpeg', quality: 90 },
          wait,
          signal,
        ),
      });
    }
  } catch (error) {
    captureError = error;
  } finally {
    try {
      ScreenshotRestoreResultSchema.parse(
        await sendPageCommandBounded(
          dependencies,
          tabId,
          {
          source: 'lens-background',
          command: 'page.screenshot.restore',
          payload: { sessionId: prepared.sessionId },
          },
          undefined,
        ),
      );
    } catch (error) {
      restoreError = error;
    }
  }

  if (captureError) {
    throw captureError;
  }
  if (restoreError) {
    throw new Error(
      `Screenshot captured but page restoration failed: ${describeError(restoreError)}`,
    );
  }
  throwIfAborted(signal);
  if (segments.length === 0) {
    throw new Error('Screenshot capture returned no segments.');
  }
  validateCoverage(segments, prepared.viewportHeight, captureHeight);

  const stitched = await stitchSegments(
    segments,
    prepared.viewportWidth,
    prepared.viewportHeight,
    captureHeight,
  );
  return ScreenshotResultSchema.parse({
    ...stitched,
    filename: timestampedFilename('full-page', 'jpg'),
    mimeType: 'image/jpeg',
    mode,
    truncated: captureHeight < prepared.documentHeight,
  });
}

async function captureWithRateLimit(
  dependencies: ScreenshotDependencies,
  expectedTab: Required<Pick<ScreenshotTab, 'id' | 'windowId'>> &
    Pick<ScreenshotTab, 'url'>,
  options: { format: 'png' | 'jpeg'; quality?: number },
  wait: (milliseconds: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<string> {
  const delay = CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt);
  if (delay > 0) {
    await abortableWait(delay, wait, signal);
  }
  await assertActiveTab(dependencies, expectedTab);
  throwIfAborted(signal);
  const dataUrl = await withTimeout(
    dependencies.captureVisibleTab(expectedTab.windowId, options),
    3_000,
    signal,
    'Visible tab capture timed out.',
  );
  lastCaptureAt = Date.now();
  await assertActiveTab(dependencies, expectedTab);
  throwIfAborted(signal);
  return dataUrl;
}

async function assertActiveTab(
  dependencies: ScreenshotDependencies,
  expectedTab: Required<Pick<ScreenshotTab, 'id' | 'windowId'>> &
    Pick<ScreenshotTab, 'url'>,
): Promise<void> {
  const activeTab = await dependencies.getActiveTab();
  if (!sameTab(activeTab, expectedTab)) {
    throw new Error('The active page changed during screenshot capture.');
  }
}

function sameTab(
  actual: ScreenshotTab | undefined,
  expected: Required<Pick<ScreenshotTab, 'id' | 'windowId'>> &
    Pick<ScreenshotTab, 'url'>,
): boolean {
  return Boolean(
    actual &&
      actual.id === expected.id &&
      actual.windowId === expected.windowId &&
      (!expected.url || !actual.url || actual.url === expected.url),
  );
}

async function abortableWait(
  milliseconds: number,
  wait: (milliseconds: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!signal) {
    await wait(milliseconds);
    return;
  }

  await withTimeout(
    wait(milliseconds),
    milliseconds + 1_000,
    signal,
    'Screenshot wait timed out.',
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Screenshot cancelled.', 'AbortError');
  }
}

async function withPrepareCleanup(
  operation: Promise<unknown>,
  dependencies: ScreenshotDependencies,
  tabId: number,
  sessionId: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const restore = () =>
    sendPageCommandBounded(
      dependencies,
      tabId,
      {
        source: 'lens-background',
        command: 'page.screenshot.restore',
        payload: { sessionId },
      },
      undefined,
    ).catch(() => undefined);

  try {
    return await withTimeout(
      operation,
      2_000,
      signal,
      'Page command page.screenshot.prepare timed out.',
    );
  } catch (error) {
    await restore();
    void operation.then(restore, restore);
    throw error;
  }
}

async function sendPageCommandBounded(
    dependencies: ScreenshotDependencies,
    tabId: number,
    command: PageCommand,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return withTimeout(
      dependencies.sendPageCommand(tabId, command),
      2_000,
      signal,
      `Page command ${command.command} timed out.`,
    );
  }

  function withTimeout<T>(
    operation: Promise<T>,
    milliseconds: number,
    signal: AbortSignal | undefined,
    timeoutMessage: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(() => reject(new Error(timeoutMessage))),
        milliseconds,
      );
      const handleAbort = () =>
        finish(() =>
          reject(new DOMException('Screenshot cancelled.', 'AbortError')),
        );
      const finish = (complete: () => void) => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', handleAbort);
        complete();
      };

      if (signal?.aborted) {
        handleAbort();
        return;
      }
      signal?.addEventListener('abort', handleAbort, { once: true });
      operation.then(
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
    });
  }

  function validateCoverage(
    segments: CaptureSegment[],
    viewportHeight: number,
    captureHeight: number,
  ): void {
    const sorted = [...segments].sort((left, right) => left.scrollY - right.scrollY);
    if (sorted[0]!.scrollY > 2) {
      throw new Error('Screenshot segments do not begin at the top of the page.');
    }
    for (let index = 0; index < sorted.length - 1; index += 1) {
      if (sorted[index + 1]!.scrollY - sorted[index]!.scrollY > viewportHeight + 2) {
        throw new Error('Screenshot segments contain an uncaptured vertical gap.');
      }
    }
    const last = sorted.at(-1)!;
    if (last.scrollY + viewportHeight < captureHeight - 2) {
      throw new Error('Screenshot segments do not cover the requested page height.');
    }
}

export function createScrollPositions(
  documentHeight: number,
  viewportHeight: number,
  captureHeight: number,
): number[] {
  const positions: number[] = [];
  const maximumScroll = Math.max(0, documentHeight - viewportHeight);
  for (let y = 0; y < captureHeight; y += viewportHeight) {
    positions.push(Math.min(y, maximumScroll));
  }
  return Array.from(new Set(positions));
}

async function stitchSegments(
  segments: CaptureSegment[],
  viewportWidth: number,
  viewportHeight: number,
  captureHeight: number,
) {
  const sorted = [...segments].sort((left, right) => left.scrollY - right.scrollY);
  const firstBitmap = await decodeDataUrl(sorted[0]!.dataUrl);
  const sourceScale = firstBitmap.width / viewportWidth;
  const unscaledHeight = Math.ceil(captureHeight * sourceScale);
  const outputScale = Math.min(
    1,
    Math.sqrt(MAX_OUTPUT_PIXELS / (firstBitmap.width * unscaledHeight)),
  );
  const outputWidth = Math.max(1, Math.round(firstBitmap.width * outputScale));
  const outputHeight = Math.max(1, Math.round(unscaledHeight * outputScale));
  firstBitmap.close();

  const canvas = new OffscreenCanvas(outputWidth, outputHeight);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Screenshot canvas is unavailable.');
  }

  for (const [index, segment] of sorted.entries()) {
    const bitmap = await decodeDataUrl(segment.dataUrl);
    try {
      const nextY = sorted[index + 1]?.scrollY ?? captureHeight;
      const cssHeight = Math.min(
        viewportHeight,
        captureHeight - segment.scrollY,
        Math.max(0, nextY - segment.scrollY),
      );
      if (cssHeight <= 0) {
        continue;
      }
      const sourceHeight = Math.min(
        bitmap.height,
        Math.ceil(cssHeight * sourceScale),
      );
      const destinationY = Math.round(
        segment.scrollY * sourceScale * outputScale,
      );
      const destinationHeight = Math.min(
        outputHeight - destinationY,
        Math.ceil(sourceHeight * outputScale),
      );
      context.drawImage(
        bitmap,
        0,
        0,
        bitmap.width,
        sourceHeight,
        0,
        destinationY,
        outputWidth,
        destinationHeight,
      );
    } finally {
      bitmap.close();
    }
  }

  let blob = await canvas.convertToBlob({
    type: 'image/jpeg',
    quality: 0.86,
  });
  if (blob.size > MAX_OUTPUT_BYTES) {
    blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: 0.65,
    });
  }
  if (blob.size > MAX_OUTPUT_BYTES) {
    throw new Error('Screenshot exceeded the 6 MiB size limit.');
  }

  return {
    dataUrl: await blobToDataUrl(blob),
    width: outputWidth,
    height: outputHeight,
  };
}

async function decodeDataUrl(dataUrl: string): Promise<ImageBitmap> {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error('Could not decode a captured screenshot segment.');
  }
  return createImageBitmap(await response.blob());
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 32_768) {
    chunks.push(
      String.fromCharCode(...bytes.subarray(index, index + 32_768)),
    );
  }
  return `data:${blob.type};base64,${btoa(chunks.join(''))}`;
}

function timestampedFilename(
  mode: ScreenshotMode,
  extension: 'png' | 'jpg',
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `lens-${mode}-${timestamp}.${extension}`;
}

function readRequestId(message: unknown): string {
  if (
    typeof message === 'object' &&
    message !== null &&
    'requestId' in message &&
    typeof message.requestId === 'string'
  ) {
    return message.requestId.slice(0, 128) || 'unknown';
  }
  return 'unknown';
}
