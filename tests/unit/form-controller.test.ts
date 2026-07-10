import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElementRegistry } from '../../src/content/element-registry';
import { fillFields } from '../../src/content/form-controller';

const visibleBounds = {
  x: 0,
  y: 0,
  top: 0,
  right: 160,
  bottom: 32,
  left: 0,
  width: 160,
  height: 32,
  toJSON: () => ({}),
};

function payload(
  registry: ElementRegistry,
  fields: { nodeId: string; value: string }[],
) {
  return {
    snapshotId: registry.snapshotId,
    generation: registry.generation,
    fields,
  };
}

describe('fillFields', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      visibleBounds,
    );
  });

  it('fills text inputs and textareas through native setters with events', () => {
    document.body.innerHTML = `
      <input name="name" value="old" />
      <textarea name="notes"></textarea>
    `;
    const registry = new ElementRegistry(1);
    const input = document.querySelector('input')!;
    const textarea = document.querySelector('textarea')!;
    const inputEvents: string[] = [];
    input.addEventListener('input', () => inputEvents.push('input'));
    input.addEventListener('change', () => inputEvents.push('change'));

    const inputId = registry.register(input);
    const textareaId = registry.register(textarea);

    const result = fillFields(registry, payload(registry, [
      { nodeId: inputId, value: 'Grace Hopper' },
      { nodeId: textareaId, value: 'Priority account' },
    ]));

    expect(result).toEqual({
      ok: true,
      result: {
        snapshotId: registry.snapshotId,
        generation: registry.generation,
        outcomes: [
          { nodeId: inputId, status: 'filled' },
          { nodeId: textareaId, status: 'filled' },
        ],
      },
    });
    expect(input.value).toBe('Grace Hopper');
    expect(textarea.value).toBe('Priority account');
    expect(inputEvents).toEqual(['input', 'change']);
  });

  it('rejects the whole request when the snapshot is stale', () => {
    document.body.innerHTML = '<input name="name" />';
    const registry = new ElementRegistry(2);
    const nodeId = registry.register(document.querySelector('input')!);

    const staleResult = fillFields(registry, {
      snapshotId: registry.snapshotId,
      generation: registry.generation + 1,
      fields: [{ nodeId, value: 'x' }],
    });
    const missingResult = fillFields(undefined, {
      snapshotId: 'anything',
      generation: 1,
      fields: [{ nodeId, value: 'x' }],
    });

    expect(staleResult).toMatchObject({ ok: false, code: 'STALE_SNAPSHOT' });
    expect(missingResult).toMatchObject({ ok: false, code: 'STALE_SNAPSHOT' });
    expect(document.querySelector('input')!.value).toBe('');
  });

  it('refuses sensitive fields at fill time regardless of the request', () => {
    document.body.innerHTML = '<input name="password" type="password" />';
    const registry = new ElementRegistry(3);
    const nodeId = registry.register(document.querySelector('input')!);

    const result = fillFields(registry, payload(registry, [
      { nodeId, value: 'hunter2' },
    ]));

    expect(result).toMatchObject({
      ok: true,
      result: {
        outcomes: [{ nodeId, status: 'rejected', reason: 'sensitive' }],
      },
    });
    expect(document.querySelector('input')!.value).toBe('');
  });

  it('rejects unknown, detached, readonly, disabled, and unsupported fields individually', () => {
    document.body.innerHTML = `
      <input name="ro" readonly />
      <input name="off" disabled />
      <input name="check" type="checkbox" />
      <input name="gone" />
    `;
    const registry = new ElementRegistry(4);
    const readonlyId = registry.register(
      document.querySelector('input[name="ro"]')!,
    );
    const disabledId = registry.register(
      document.querySelector('input[name="off"]')!,
    );
    const checkboxId = registry.register(
      document.querySelector('input[name="check"]')!,
    );
    const detachedElement = document.querySelector('input[name="gone"]')!;
    const detachedId = registry.register(detachedElement);
    detachedElement.remove();

    const result = fillFields(registry, payload(registry, [
      { nodeId: readonlyId, value: 'a' },
      { nodeId: disabledId, value: 'b' },
      { nodeId: checkboxId, value: 'c' },
      { nodeId: detachedId, value: 'd' },
      { nodeId: 'node_missing', value: 'e' },
    ]));

    expect(result).toMatchObject({
      ok: true,
      result: {
        outcomes: [
          { nodeId: readonlyId, status: 'rejected', reason: 'readonly' },
          { nodeId: disabledId, status: 'rejected', reason: 'disabled' },
          {
            nodeId: checkboxId,
            status: 'rejected',
            reason: 'unsupported-type',
          },
          { nodeId: detachedId, status: 'rejected', reason: 'detached' },
          { nodeId: 'node_missing', status: 'rejected', reason: 'not-found' },
        ],
      },
    });
  });

  it('rejects hidden fields without writing values', () => {
    document.body.innerHTML = '<input name="ghost" style="display: none" />';
    const registry = new ElementRegistry(5);
    const input = document.querySelector('input')!;
    const nodeId = registry.register(input);

    const result = fillFields(registry, payload(registry, [
      { nodeId, value: 'boo' },
    ]));

    expect(result).toMatchObject({
      ok: true,
      result: { outcomes: [{ nodeId, status: 'rejected', reason: 'hidden' }] },
    });
    expect(input.value).toBe('');
  });
});
