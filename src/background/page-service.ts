import {
  RuntimeRequestSchema,
  type FillRequest,
  type FillResponse,
  type RuntimeErrorCode,
  type RuntimeResponse,
  type SnapshotRequest,
  type SnapshotResponse,
} from '../protocol/messages';
import {
  FillCommandResultSchema,
  type PageCommand,
} from '../protocol/page-commands';
import { PageSnapshotSchema } from '../protocol/page-snapshot';

export interface ActiveTab {
  id?: number;
  windowId?: number;
  url?: string;
}

export interface PageServiceDependencies {
  getActiveTab: () => Promise<ActiveTab | undefined>;
  ensurePageAgent: (tabId: number) => Promise<void>;
  sendPageCommand: (tabId: number, command: PageCommand) => Promise<unknown>;
}

type ResponseType = RuntimeResponse['type'];

function readRequestId(message: unknown): string {
  if (
    typeof message === 'object' &&
    message !== null &&
    'requestId' in message &&
    typeof message.requestId === 'string' &&
    message.requestId.length > 0
  ) {
    return message.requestId.slice(0, 128);
  }

  return 'unknown';
}

function readResponseType(message: unknown): ResponseType {
  if (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'lens.page.fill.request'
  ) {
    return 'lens.page.fill.response';
  }

  return 'lens.page.snapshot.response';
}

function failure(
  type: ResponseType,
  requestId: string,
  code: RuntimeErrorCode,
  message: string,
  details?: string,
): RuntimeResponse {
  return {
    type,
    requestId,
    ok: false,
    error: { code, message, details },
  } as RuntimeResponse;
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 300);
  }

  return String(error).slice(0, 300);
}

function isPermissionError(message: string): boolean {
  return /cannot access|missing host permission|cannot be scripted|permission/i.test(
    message,
  );
}

interface CommandContext {
  tabId: number;
  dependencies: PageServiceDependencies;
}

type Prepared =
  | { ok: true; context: CommandContext }
  | { ok: false; response: RuntimeResponse };

async function prepareTab(
  type: ResponseType,
  requestId: string,
  genericFailure: RuntimeErrorCode,
  dependencies: PageServiceDependencies,
): Promise<Prepared> {
  let tab: ActiveTab | undefined;
  try {
    tab = await dependencies.getActiveTab();
  } catch (error) {
    return {
      ok: false,
      response: failure(
        type,
        requestId,
        genericFailure,
        'Lens could not inspect the active browser tab.',
        describeError(error),
      ),
    };
  }

  if (typeof tab?.id !== 'number') {
    return {
      ok: false,
      response: failure(
        type,
        requestId,
        'NO_ACTIVE_TAB',
        'Lens could not find an active browser tab.',
      ),
    };
  }

  if (tab.url && !/^https?:\/\//i.test(tab.url)) {
    return {
      ok: false,
      response: failure(
        type,
        requestId,
        'UNSUPPORTED_PAGE',
        'Lens only observes HTTP and HTTPS pages.',
      ),
    };
  }

  try {
    await dependencies.ensurePageAgent(tab.id);
  } catch (error) {
    const details = describeError(error);
    return {
      ok: false,
      response: failure(
        type,
        requestId,
        isPermissionError(details) ? 'PAGE_ACCESS_DENIED' : genericFailure,
        isPermissionError(details)
          ? 'Lens does not have access to this page.'
          : 'Lens could not attach the page agent.',
        details,
      ),
    };
  }

  return { ok: true, context: { tabId: tab.id, dependencies } };
}

async function handleSnapshotRequest(
  request: SnapshotRequest,
  dependencies: PageServiceDependencies,
): Promise<SnapshotResponse> {
  const type = 'lens.page.snapshot.response';
  const prepared = await prepareTab(
    type,
    request.requestId,
    'SNAPSHOT_FAILED',
    dependencies,
  );
  if (!prepared.ok) {
    return prepared.response as SnapshotResponse;
  }

  let rawSnapshot: unknown;
  try {
    rawSnapshot = await prepared.context.dependencies.sendPageCommand(
      prepared.context.tabId,
      { source: 'lens-background', command: 'page.snapshot' },
    );
  } catch (error) {
    return failure(
      type,
      request.requestId,
      'SNAPSHOT_FAILED',
      'Lens could not build a semantic page snapshot.',
      describeError(error),
    ) as SnapshotResponse;
  }

  const parsedSnapshot = PageSnapshotSchema.safeParse(rawSnapshot);
  if (!parsedSnapshot.success) {
    return failure(
      type,
      request.requestId,
      'INVALID_SNAPSHOT',
      'The page returned an invalid semantic snapshot.',
      parsedSnapshot.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    ) as SnapshotResponse;
  }

  return {
    type,
    requestId: request.requestId,
    ok: true,
    snapshot: parsedSnapshot.data,
  };
}

async function handleFillRequest(
  request: FillRequest,
  dependencies: PageServiceDependencies,
): Promise<FillResponse> {
  const type = 'lens.page.fill.response';
  const prepared = await prepareTab(
    type,
    request.requestId,
    'FILL_FAILED',
    dependencies,
  );
  if (!prepared.ok) {
    return prepared.response as FillResponse;
  }

  let rawResult: unknown;
  try {
    rawResult = await prepared.context.dependencies.sendPageCommand(
      prepared.context.tabId,
      {
        source: 'lens-background',
        command: 'page.form.fill',
        payload: {
          snapshotId: request.snapshotId,
          generation: request.generation,
          fields: request.fields,
        },
      },
    );
  } catch (error) {
    return failure(
      type,
      request.requestId,
      'FILL_FAILED',
      'Lens could not apply the form fill.',
      describeError(error),
    ) as FillResponse;
  }

  const parsedResult = FillCommandResultSchema.safeParse(rawResult);
  if (!parsedResult.success) {
    return failure(
      type,
      request.requestId,
      'FILL_FAILED',
      'The page returned an invalid fill result.',
      parsedResult.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    ) as FillResponse;
  }

  if (!parsedResult.data.ok) {
    return failure(
      type,
      request.requestId,
      'STALE_SNAPSHOT',
      parsedResult.data.message,
    ) as FillResponse;
  }

  return {
    type,
    requestId: request.requestId,
    ok: true,
    result: parsedResult.data.result,
  };
}

export async function handleRuntimeRequest(
  message: unknown,
  dependencies: PageServiceDependencies,
): Promise<RuntimeResponse> {
  const parsedRequest = RuntimeRequestSchema.safeParse(message);
  if (!parsedRequest.success) {
    return failure(
      readResponseType(message),
      readRequestId(message),
      'INVALID_REQUEST',
      'The runtime request did not match the Lens protocol.',
    );
  }

  if (parsedRequest.data.type === 'lens.page.fill.request') {
    return handleFillRequest(parsedRequest.data, dependencies);
  }

  return handleSnapshotRequest(parsedRequest.data, dependencies);
}
