import { describe, expect, it } from 'vitest';
import { shouldHandleActionInvocation } from '../../src/protocol/messages';

describe('shouldHandleActionInvocation', () => {
  it('accepts an action invocation for the panel window', () => {
    expect(
      shouldHandleActionInvocation(
        { type: 'lens.action.invoked', windowId: 7 },
        7,
      ),
    ).toBe(true);
  });

  it('ignores invocations for other windows', () => {
    expect(
      shouldHandleActionInvocation(
        { type: 'lens.action.invoked', windowId: 7 },
        9,
      ),
    ).toBe(false);
  });

  it('falls back to handling when the panel window is unknown', () => {
    expect(
      shouldHandleActionInvocation(
        { type: 'lens.action.invoked', windowId: 7 },
        undefined,
      ),
    ).toBe(true);
  });

  it('ignores unrelated runtime messages', () => {
    expect(
      shouldHandleActionInvocation(
        { type: 'lens.page.snapshot.request', requestId: 'r1' },
        7,
      ),
    ).toBe(false);
    expect(shouldHandleActionInvocation(undefined, 7)).toBe(false);
    expect(
      shouldHandleActionInvocation(
        { type: 'lens.action.invoked', windowId: 'x' },
        7,
      ),
    ).toBe(false);
  });
});
