import type {
  ClickCommandResult,
  ClickOutcome,
  ClickRejectReason,
} from '../protocol/page-commands';
import type { ElementRegistry } from './element-registry';
import { isElementVisible } from './page-observer';

export interface ClickPayload {
  snapshotId: string;
  generation: number;
  nodeId: string;
}

const BLOCKED_DECLARED_RISKS = new Set([
  'server-write',
  'destructive',
  'financial',
]);

function rejected(nodeId: string, reason: ClickRejectReason): ClickOutcome {
  return { nodeId, status: 'rejected', reason };
}

function isFormSubmitter(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement) {
    return element.type === 'submit' || element.type === 'image';
  }
  if (element instanceof HTMLButtonElement) {
    // A button without an explicit type submits its owning form by default.
    return element.type === 'submit' && element.form !== null;
  }
  return false;
}

function hasBlockedDeclaredRisk(element: HTMLElement): boolean {
  const declared = element.closest<HTMLElement>('[data-agent-risk]');
  return Boolean(
    declared && BLOCKED_DECLARED_RISKS.has(declared.dataset.agentRisk ?? ''),
  );
}

function dispatchClickSequence(element: HTMLElement, view: Window): void {
  if (typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ block: 'center', inline: 'center' });
  }

  const bounds = element.getBoundingClientRect();
  const shared = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view,
    clientX: Math.round(bounds.left + bounds.width / 2),
    clientY: Math.round(bounds.top + bounds.height / 2),
    button: 0,
    detail: 1,
  };
  const pointer = {
    ...shared,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
  };

  if (typeof PointerEvent === 'function') {
    element.dispatchEvent(new PointerEvent('pointerdown', pointer));
  }
  element.dispatchEvent(new MouseEvent('mousedown', shared));
  if (typeof element.focus === 'function') {
    element.focus();
  }
  if (typeof PointerEvent === 'function') {
    element.dispatchEvent(new PointerEvent('pointerup', pointer));
  }
  element.dispatchEvent(new MouseEvent('mouseup', shared));
  element.dispatchEvent(new MouseEvent('click', shared));
}

function clickSingleElement(element: Element): ClickRejectReason | 'clicked' {
  if (!(element instanceof HTMLElement)) {
    return 'unsupported-type';
  }

  const view = element.ownerDocument.defaultView;
  if (!view || !isElementVisible(element, view)) {
    return 'hidden';
  }

  if (
    ('disabled' in element &&
      Boolean((element as HTMLButtonElement).disabled)) ||
    element.getAttribute('aria-disabled') === 'true'
  ) {
    return 'disabled';
  }

  // Form submission is a server-write. Until the confirmation policy ships,
  // the runtime refuses to submit instead of letting the model decide.
  if (isFormSubmitter(element)) {
    return 'submit-blocked';
  }

  if (hasBlockedDeclaredRisk(element)) {
    return 'risk-blocked';
  }

  dispatchClickSequence(element, view);
  return 'clicked';
}

export function clickNode(
  registry: ElementRegistry | undefined,
  payload: ClickPayload,
): ClickCommandResult {
  if (
    !registry ||
    registry.snapshotId !== payload.snapshotId ||
    registry.generation !== payload.generation
  ) {
    return {
      ok: false,
      code: 'STALE_SNAPSHOT',
      message:
        'The page changed since this snapshot was taken. Rescan before clicking.',
    };
  }

  const element = registry.resolve(payload.nodeId);
  let outcome: ClickOutcome;
  if (!element) {
    outcome = rejected(payload.nodeId, 'not-found');
  } else if (!element.isConnected) {
    outcome = rejected(payload.nodeId, 'detached');
  } else {
    const result = clickSingleElement(element);
    outcome =
      result === 'clicked'
        ? { nodeId: payload.nodeId, status: 'clicked' }
        : rejected(payload.nodeId, result);
  }

  return {
    ok: true,
    result: {
      snapshotId: registry.snapshotId,
      generation: registry.generation,
      outcome,
    },
  };
}
