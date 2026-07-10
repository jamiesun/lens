import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDocumentElementRegistry,
  ElementRegistry,
} from '../../src/content/element-registry';

describe('ElementRegistry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates snapshot ids on insecure contexts without randomUUID', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => {
        array.fill(0xab);
        return array;
      },
    });

    const registry = new ElementRegistry(1);

    expect(registry.snapshotId).toMatch(/^snapshot_[0-9a-f]{32}$/);
  });

  it('increments the document-scoped generation on every registry rebuild', () => {
    const first = createDocumentElementRegistry();
    const second = createDocumentElementRegistry();

    expect(second.generation).toBe(first.generation + 1);
    expect(second.snapshotId).not.toBe(first.snapshotId);
  });

  it('reuses one node id per element within a generation', () => {
    const registry = new ElementRegistry(3);
    const element = document.createElement('button');

    const nodeId = registry.register(element);

    expect(registry.register(element)).toBe(nodeId);
    expect(registry.resolve(nodeId)).toBe(element);
  });
});
