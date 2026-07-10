import { browser } from 'wxt/browser';
import {
  FillResponseSchema,
  SnapshotResponseSchema,
  type RuntimeErrorCode,
} from '../protocol/messages';
import type {
  FillFieldValue,
  FillResult,
} from '../protocol/page-commands';
import type { PageSnapshot } from '../protocol/page-snapshot';

function createRequestId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `request_${Date.now().toString(36)}`;
}

export class LensRuntimeError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    message: string,
    readonly details?: string,
  ) {
    super(message);
    this.name = 'LensRuntimeError';
  }
}

export async function requestPageSnapshot(): Promise<PageSnapshot> {
  const response = await browser.runtime.sendMessage({
    type: 'lens.page.snapshot.request',
    requestId: createRequestId(),
  });
  const parsedResponse = SnapshotResponseSchema.safeParse(response);

  if (!parsedResponse.success) {
    throw new LensRuntimeError(
      'INVALID_SNAPSHOT',
      'The Lens runtime returned an invalid response.',
      parsedResponse.error.message,
    );
  }

  if (!parsedResponse.data.ok) {
    throw new LensRuntimeError(
      parsedResponse.data.error.code,
      parsedResponse.data.error.message,
      parsedResponse.data.error.details,
    );
  }

  return parsedResponse.data.snapshot;
}

export interface FormFillInput {
  snapshotId: string;
  generation: number;
  fields: FillFieldValue[];
}

export async function requestFormFill(
  input: FormFillInput,
): Promise<FillResult> {
  const response = await browser.runtime.sendMessage({
    type: 'lens.page.fill.request',
    requestId: createRequestId(),
    snapshotId: input.snapshotId,
    generation: input.generation,
    fields: input.fields,
  });
  const parsedResponse = FillResponseSchema.safeParse(response);

  if (!parsedResponse.success) {
    throw new LensRuntimeError(
      'FILL_FAILED',
      'The Lens runtime returned an invalid fill response.',
      parsedResponse.error.message,
    );
  }

  if (!parsedResponse.data.ok) {
    throw new LensRuntimeError(
      parsedResponse.data.error.code,
      parsedResponse.data.error.message,
      parsedResponse.data.error.details,
    );
  }

  return parsedResponse.data.result;
}
