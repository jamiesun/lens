import {
  RuntimeRequestSchema,
  type RuntimeResponse,
  type SnapshotErrorCode,
} from '../protocol/messages';
import { PageSnapshotSchema } from '../protocol/page-snapshot';

export interface ActiveTab {
  id?: number;
  url?: string;
}

export interface SnapshotDependencies {
  getActiveTab: () => Promise<ActiveTab | undefined>;
  executeSnapshot: (tabId: number) => Promise<unknown>;
}

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

function failure(
  requestId: string,
  code: SnapshotErrorCode,
  message: string,
  details?: string,
): RuntimeResponse {
  return {
    type: 'lens.page.snapshot.response',
    requestId,
    ok: false,
    error: {
      code,
      message,
      details,
    },
  };
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

export async function handleRuntimeRequest(
  message: unknown,
  dependencies: SnapshotDependencies,
): Promise<RuntimeResponse> {
  const parsedRequest = RuntimeRequestSchema.safeParse(message);
  if (!parsedRequest.success) {
    return failure(
      readRequestId(message),
      'INVALID_REQUEST',
      'The runtime request did not match the Lens protocol.',
    );
  }

  const { requestId } = parsedRequest.data;

  let tab: ActiveTab | undefined;
  try {
    tab = await dependencies.getActiveTab();
  } catch (error) {
    return failure(
      requestId,
      'SNAPSHOT_FAILED',
      'Lens could not inspect the active browser tab.',
      describeError(error),
    );
  }

  if (typeof tab?.id !== 'number') {
    return failure(
      requestId,
      'NO_ACTIVE_TAB',
      'Lens could not find an active browser tab.',
    );
  }

  if (tab.url && !/^https?:\/\//i.test(tab.url)) {
    return failure(
      requestId,
      'UNSUPPORTED_PAGE',
      'Lens only observes HTTP and HTTPS pages.',
    );
  }

  try {
    const rawSnapshot = await dependencies.executeSnapshot(tab.id);
    const parsedSnapshot = PageSnapshotSchema.safeParse(rawSnapshot);
    if (!parsedSnapshot.success) {
      return failure(
        requestId,
        'INVALID_SNAPSHOT',
        'The page returned an invalid semantic snapshot.',
        parsedSnapshot.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; '),
      );
    }

    return {
      type: 'lens.page.snapshot.response',
      requestId,
      ok: true,
      snapshot: parsedSnapshot.data,
    };
  } catch (error) {
    const details = describeError(error);
    if (isPermissionError(details)) {
      return failure(
        requestId,
        'PAGE_ACCESS_DENIED',
        'Lens does not have access to this page.',
        details,
      );
    }

    return failure(
      requestId,
      'SNAPSHOT_FAILED',
      'Lens could not build a semantic page snapshot.',
      details,
    );
  }
}
