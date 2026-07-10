function createSnapshotId(): string {
  // randomUUID is unavailable in insecure contexts (plain-HTTP intranet pages).
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `snapshot_${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`;
}

export class ElementRegistry {
  readonly elements = new Map<string, Element>();

  private readonly nodeIds = new WeakMap<Element, string>();
  private counter = 0;

  constructor(
    readonly generation: number,
    readonly snapshotId = createSnapshotId(),
  ) {}

  register(element: Element): string {
    const existing = this.nodeIds.get(element);
    if (existing) {
      return existing;
    }

    this.counter += 1;
    const nodeId = `node_${this.generation.toString(36)}_${this.counter
      .toString(36)
      .padStart(3, '0')}`;

    this.nodeIds.set(element, nodeId);
    this.elements.set(nodeId, element);
    return nodeId;
  }

  resolve(nodeId: string): Element | undefined {
    return this.elements.get(nodeId);
  }
}

interface RegistryHolder {
  generation: number;
  registry: ElementRegistry;
}

interface RegistryGlobal {
  __lensElementRegistryV1?: RegistryHolder;
}

export function createDocumentElementRegistry(): ElementRegistry {
  const registryGlobal = globalThis as typeof globalThis & RegistryGlobal;
  const generation =
    (registryGlobal.__lensElementRegistryV1?.generation ?? 0) + 1;
  const registry = new ElementRegistry(generation);

  registryGlobal.__lensElementRegistryV1 = {
    generation,
    registry,
  };

  return registry;
}
