import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clickNode } from '../../src/content/click-controller';
import { ElementRegistry } from '../../src/content/element-registry';

const visibleBounds = {
  x: 40,
  y: 20,
  top: 20,
  right: 200,
  bottom: 60,
  left: 40,
  width: 160,
  height: 40,
  toJSON: () => ({}),
};

function payload(registry: ElementRegistry, nodeId: string) {
  return {
    snapshotId: registry.snapshotId,
    generation: registry.generation,
    nodeId,
  };
}

describe('clickNode', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      visibleBounds,
    );
  });

  it('dispatches a realistic event sequence with element-center coordinates', () => {
    document.body.innerHTML = '<button type="button">Solve</button>';
    const button = document.querySelector('button')!;
    const seen: { type: string; x?: number; y?: number }[] = [];
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      button.addEventListener(type, (event) => {
        const mouse = event as MouseEvent;
        seen.push({ type, x: mouse.clientX, y: mouse.clientY });
      });
    }

    const registry = new ElementRegistry(1);
    const nodeId = registry.register(button);
    const result = clickNode(registry, payload(registry, nodeId));

    expect(result).toEqual({
      ok: true,
      result: {
        snapshotId: registry.snapshotId,
        generation: registry.generation,
        outcome: { nodeId, status: 'clicked' },
      },
    });
    expect(seen.map((event) => event.type)).toContain('mousedown');
    expect(seen.map((event) => event.type)).toContain('mouseup');
    expect(seen.at(-1)).toEqual({ type: 'click', x: 120, y: 40 });
  });

  it('clicks plain elements with a pointer affordance, like a game peg', () => {
    document.body.innerHTML =
      '<div class="peg" data-peg="0" style="cursor: pointer"><div class="peg__rod"></div></div>';
    const peg = document.querySelector<HTMLElement>('.peg')!;
    let moves = 0;
    peg.addEventListener('click', () => {
      moves += 1;
    });

    const registry = new ElementRegistry(1);
    const nodeId = registry.register(peg);
    const result = clickNode(registry, payload(registry, nodeId));

    expect(result).toMatchObject({
      ok: true,
      result: { outcome: { nodeId, status: 'clicked' } },
    });
    expect(moves).toBe(1);
  });

  it('rejects the whole request when the snapshot is stale', () => {
    document.body.innerHTML = '<button type="button">Old</button>';
    const registry = new ElementRegistry(3);
    const nodeId = registry.register(document.querySelector('button')!);
    let clicked = false;
    document
      .querySelector('button')!
      .addEventListener('click', () => {
        clicked = true;
      });

    const result = clickNode(registry, {
      snapshotId: registry.snapshotId,
      generation: registry.generation + 1,
      nodeId,
    });

    expect(result).toEqual({
      ok: false,
      code: 'STALE_SNAPSHOT',
      message:
        'The page changed since this snapshot was taken. Rescan before clicking.',
    });
    expect(clicked).toBe(false);
  });

  it('rejects unknown and detached nodes without clicking anything', () => {
    document.body.innerHTML = '<button type="button">Ghost</button>';
    const registry = new ElementRegistry(1);
    const button = document.querySelector('button')!;
    const nodeId = registry.register(button);
    button.remove();

    expect(
      clickNode(registry, payload(registry, 'node_missing')),
    ).toMatchObject({
      ok: true,
      result: {
        outcome: {
          nodeId: 'node_missing',
          status: 'rejected',
          reason: 'not-found',
        },
      },
    });
    expect(clickNode(registry, payload(registry, nodeId))).toMatchObject({
      ok: true,
      result: {
        outcome: { nodeId, status: 'rejected', reason: 'detached' },
      },
    });
  });

  it('rejects hidden and disabled elements', () => {
    document.body.innerHTML = `
      <button type="button" style="display: none">Hidden</button>
      <button type="button" disabled>Disabled</button>
    `;
    const registry = new ElementRegistry(1);
    const [hidden, disabled] = Array.from(document.querySelectorAll('button'));
    const hiddenId = registry.register(hidden!);
    const disabledId = registry.register(disabled!);

    expect(clickNode(registry, payload(registry, hiddenId))).toMatchObject({
      ok: true,
      result: {
        outcome: { nodeId: hiddenId, status: 'rejected', reason: 'hidden' },
      },
    });
    expect(clickNode(registry, payload(registry, disabledId))).toMatchObject({
      ok: true,
      result: {
        outcome: {
          nodeId: disabledId,
          status: 'rejected',
          reason: 'disabled',
        },
      },
    });
  });

  it('blocks form submitters until the confirmation policy exists', () => {
    document.body.innerHTML = `
      <form>
        <button id="explicit" type="submit">Save</button>
        <button id="implicit">Save too</button>
        <input id="input-submit" type="submit" value="Save now" />
      </form>
    `;
    const registry = new ElementRegistry(1);
    const form = document.querySelector('form')!;
    let submitted = false;
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submitted = true;
    });

    for (const id of ['explicit', 'implicit', 'input-submit']) {
      const nodeId = registry.register(document.getElementById(id)!);
      expect(clickNode(registry, payload(registry, nodeId))).toMatchObject({
        ok: true,
        result: {
          outcome: { nodeId, status: 'rejected', reason: 'submit-blocked' },
        },
      });
    }
    expect(submitted).toBe(false);
  });

  it('blocks elements declared as high risk, including via an ancestor', () => {
    document.body.innerHTML = `
      <button id="pay" type="button" data-agent-risk="financial">Pay</button>
      <div data-agent-risk="destructive">
        <button id="purge" type="button">Purge</button>
      </div>
      <button id="local" type="button" data-agent-risk="local-write">Toggle</button>
    `;
    const registry = new ElementRegistry(1);
    let localClicked = false;
    document.getElementById('local')!.addEventListener('click', () => {
      localClicked = true;
    });

    for (const id of ['pay', 'purge']) {
      const nodeId = registry.register(document.getElementById(id)!);
      expect(clickNode(registry, payload(registry, nodeId))).toMatchObject({
        ok: true,
        result: {
          outcome: { nodeId, status: 'rejected', reason: 'risk-blocked' },
        },
      });
    }

    const localId = registry.register(document.getElementById('local')!);
    expect(clickNode(registry, payload(registry, localId))).toMatchObject({
      ok: true,
      result: { outcome: { nodeId: localId, status: 'clicked' } },
    });
    expect(localClicked).toBe(true);
  });

  it('rejects non-HTML elements as unsupported', () => {
    document.body.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"></circle></svg>';
    const registry = new ElementRegistry(1);
    const circle = document.querySelector('circle')!;
    const nodeId = registry.register(circle);

    expect(clickNode(registry, payload(registry, nodeId))).toMatchObject({
      ok: true,
      result: {
        outcome: { nodeId, status: 'rejected', reason: 'unsupported-type' },
      },
    });
  });

  it('rejects everything when no registry exists yet', () => {
    expect(
      clickNode(undefined, {
        snapshotId: 'snapshot_none',
        generation: 1,
        nodeId: 'node_any',
      }),
    ).toMatchObject({ ok: false, code: 'STALE_SNAPSHOT' });
  });
});
