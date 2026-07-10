import { browser } from 'wxt/browser';
import {
  SnapshotResponseSchema,
  type SnapshotErrorCode,
} from '../protocol/messages';
import type { PageSnapshot } from '../protocol/page-snapshot';

function createRequestId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `request_${Date.now().toString(36)}`;
}

export class SnapshotClientError extends Error {
  constructor(
    readonly code: SnapshotErrorCode,
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'SnapshotClientError';
  }
}

export async function requestPageSnapshot(): Promise<PageSnapshot> {
  const response = await browser.runtime.sendMessage({
    type: 'lens.page.snapshot.request',
    requestId: createRequestId(),
  });
  const parsedResponse = SnapshotResponseSchema.safeParse(response);

  if (!parsedResponse.success) {
    throw new SnapshotClientError(
      'INVALID_SNAPSHOT',
      'The Lens runtime returned an invalid response.',
      parsedResponse.error.message,
    );
  }

  if (!parsedResponse.data.ok) {
    throw new SnapshotClientError(
      parsedResponse.data.error.code,
      parsedResponse.data.error.message,
      parsedResponse.data.error.details,
    );
  }

  return parsedResponse.data.snapshot;
}
