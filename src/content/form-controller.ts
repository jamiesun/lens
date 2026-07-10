import type {
  FieldFillOutcome,
  FillCommandResult,
  FillFieldValue,
  FillRejectReason,
} from '../protocol/page-commands';
import type { ElementRegistry } from './element-registry';
import { isElementVisible, isFieldSensitive } from './page-observer';

export interface FillPayload {
  snapshotId: string;
  generation: number;
  fields: FillFieldValue[];
}

const SUPPORTED_INPUT_TYPES = new Set([
  'text',
  'email',
  'tel',
  'url',
  'search',
  'number',
]);

function rejected(nodeId: string, reason: FillRejectReason): FieldFillOutcome {
  return { nodeId, status: 'rejected', reason };
}

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  // Call the prototype setter so framework value-tracking (React/Vue
  // controlled inputs) observes the change instead of a shadowed property.
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillSingleField(
  element: Element,
  value: string,
): FieldFillOutcome | FillRejectReason {
  if (!(element instanceof HTMLElement)) {
    return 'unsupported-type';
  }

  const view = element.ownerDocument.defaultView;
  if (!view || !isElementVisible(element, view)) {
    return 'hidden';
  }

  if (isFieldSensitive(element)) {
    return 'sensitive';
  }

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  ) {
    if (element.disabled) {
      return 'disabled';
    }
    if (element.readOnly) {
      return 'readonly';
    }
    if (
      element instanceof HTMLInputElement &&
      !SUPPORTED_INPUT_TYPES.has(element.type)
    ) {
      return 'unsupported-type';
    }

    setNativeValue(element, value);
    return { nodeId: '', status: 'filled' };
  }

  return 'unsupported-type';
}

export function fillFields(
  registry: ElementRegistry | undefined,
  payload: FillPayload,
): FillCommandResult {
  if (
    !registry ||
    registry.snapshotId !== payload.snapshotId ||
    registry.generation !== payload.generation
  ) {
    return {
      ok: false,
      code: 'STALE_SNAPSHOT',
      message:
        'The page changed since this snapshot was taken. Rescan before filling.',
    };
  }

  const outcomes = payload.fields.map((field): FieldFillOutcome => {
    const element = registry.resolve(field.nodeId);
    if (!element) {
      return rejected(field.nodeId, 'not-found');
    }
    if (!element.isConnected) {
      return rejected(field.nodeId, 'detached');
    }

    const result = fillSingleField(element, field.value);
    if (typeof result === 'string') {
      return rejected(field.nodeId, result);
    }

    return { ...result, nodeId: field.nodeId };
  });

  return {
    ok: true,
    result: {
      snapshotId: registry.snapshotId,
      generation: registry.generation,
      outcomes,
    },
  };
}
