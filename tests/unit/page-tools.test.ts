import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  callPageTool,
  callPageToolInMain,
  discoverPageTools,
  readPageToolsInMain,
  type BoundMainWorldInvoke,
} from '../../src/background/page-tools-service';

type TestGlobal = typeof globalThis & { __lensPageToolsV1?: unknown };

function setRegistry(registry: unknown): void {
  (globalThis as TestGlobal).__lensPageToolsV1 = registry;
}

afterEach(() => {
  delete (globalThis as TestGlobal).__lensPageToolsV1;
});

const lookupTool = {
  name: 'inventory_lookup',
  description: 'Look up stock levels by keyword.',
  risk: 'observe',
  inputSchema: {
    type: 'object',
    properties: { keyword: { type: 'string' } },
    required: ['keyword'],
    additionalProperties: false,
  },
  execute: (input: { keyword: string }) => ({ echo: input.keyword }),
};

describe('readPageToolsInMain', () => {
  it('reports an absent registry', () => {
    expect(readPageToolsInMain()).toEqual({ present: false });
  });

  it('serializes a Map registry with schema JSON', () => {
    setRegistry({
      version: 1,
      sessionId: 'session-1',
      tools: new Map([[lookupTool.name, lookupTool]]),
    });

    expect(readPageToolsInMain()).toEqual({
      present: true,
      version: 1,
      sessionId: 'session-1',
      tools: [
        {
          name: 'inventory_lookup',
          description: 'Look up stock levels by keyword.',
          risk: 'observe',
          inputSchemaJson: JSON.stringify(lookupTool.inputSchema),
        },
      ],
    });
  });

  it('supports plain-object registries and lazily binds a session id', () => {
    const registry: { version: number; sessionId?: string; tools: unknown } = {
      version: 1,
      tools: { inventory_lookup: { ...lookupTool, inputSchema: undefined } },
    };
    setRegistry(registry);

    const result = readPageToolsInMain() as {
      present: boolean;
      sessionId: string;
      tools: { inputSchemaJson?: string }[];
    };

    expect(result.present).toBe(true);
    expect(result.sessionId.length).toBeGreaterThan(0);
    expect(registry.sessionId).toBe(result.sessionId);
    expect(result.tools[0]).not.toHaveProperty('inputSchemaJson');
  });

  it('marks unserializable schemas so validation fails downstream', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    setRegistry({
      version: 1,
      sessionId: 'session-1',
      tools: new Map([
        ['bad_schema', { ...lookupTool, name: 'bad_schema', inputSchema: cyclic }],
      ]),
    });

    const result = readPageToolsInMain() as {
      tools: { inputSchemaJson?: string }[];
    };
    expect(result.tools[0]?.inputSchemaJson).toBe('!unserializable');
  });
});

describe('callPageToolInMain', () => {
  const session = (tools: Record<string, unknown>) => {
    setRegistry({ version: 1, sessionId: 'session-1', tools });
  };

  it('rejects when no registry exists', async () => {
    const result = await callPageToolInMain('x', '{}', 's', 50, 100);
    expect(result).toMatchObject({ ok: false, code: 'NO_REGISTRY' });
  });

  it('rejects stale session ids', async () => {
    session({});
    const result = await callPageToolInMain('x', '{}', 'other', 50, 100);
    expect(result).toMatchObject({ ok: false, code: 'STALE_TOOLS' });
  });

  it('rejects unknown tools and non-JSON arguments', async () => {
    session({ known: lookupTool });
    expect(
      await callPageToolInMain('missing', '{}', 'session-1', 50, 100),
    ).toMatchObject({ ok: false, code: 'TOOL_NOT_FOUND' });
    expect(
      await callPageToolInMain('known', '{oops', 'session-1', 50, 100),
    ).toMatchObject({ ok: false, code: 'INVALID_ARGUMENTS' });
  });

  it('returns canonical JSON results, mapping undefined to null', async () => {
    session({
      known: { ...lookupTool, execute: () => undefined },
    });
    expect(
      await callPageToolInMain('known', '{}', 'session-1', 50, 100),
    ).toEqual({ ok: true, resultJson: 'null' });
  });

  it('maps thrown errors, timeouts, and oversized results to codes', async () => {
    session({
      throws: { execute: () => { throw new Error('boom'); } },
      hangs: { execute: () => new Promise(() => {}) },
      huge: { execute: () => 'x'.repeat(200) },
      bigint: { execute: () => ({ value: BigInt(1) }) },
    });

    expect(
      await callPageToolInMain('throws', '{}', 'session-1', 50, 100),
    ).toMatchObject({ ok: false, code: 'EXECUTE_ERROR', message: 'boom' });
    expect(
      await callPageToolInMain('hangs', '{}', 'session-1', 20, 100),
    ).toMatchObject({ ok: false, code: 'TIMEOUT' });
    expect(
      await callPageToolInMain('huge', '{}', 'session-1', 50, 100),
    ).toMatchObject({ ok: false, code: 'RESULT_TOO_LARGE' });
    expect(
      await callPageToolInMain('bigint', '{}', 'session-1', 50, 100),
    ).toMatchObject({ ok: false, code: 'RESULT_NOT_JSON' });
  });
});

function fakeInvoke(value: unknown): BoundMainWorldInvoke {
  return vi.fn().mockResolvedValue(value);
}

const wireTool = {
  name: 'inventory_lookup',
  description: 'Look up stock levels.',
  risk: 'observe',
  inputSchemaJson: JSON.stringify({ type: 'object', properties: {} }),
};

describe('discoverPageTools', () => {
  it('maps invoke failures to unavailable', async () => {
    const invoke: BoundMainWorldInvoke = vi
      .fn()
      .mockRejectedValue(new Error('The active page changed'));
    expect(await discoverPageTools(invoke)).toEqual({
      status: 'unavailable',
      detail: 'The active page changed',
    });
  });

  it('maps missing registries to absent and bad envelopes to invalid', async () => {
    expect(await discoverPageTools(fakeInvoke({ present: false }))).toEqual({
      status: 'absent',
    });
    expect(
      (await discoverPageTools(fakeInvoke({ nonsense: true }))).status,
    ).toBe('invalid');
  });

  it('reports future protocol versions as incompatible', async () => {
    expect(
      await discoverPageTools(
        fakeInvoke({ present: true, version: 99, sessionId: 's', tools: [] }),
      ),
    ).toEqual({ status: 'incompatible', version: 99 });
  });

  it('rejects the whole registry on any invalid declaration', async () => {
    const envelope = (tools: unknown[]) =>
      fakeInvoke({ present: true, version: 1, sessionId: 's', tools });

    const badName = await discoverPageTools(
      envelope([{ ...wireTool, name: 'Bad Name!' }]),
    );
    expect(badName.status).toBe('invalid');

    const badRisk = await discoverPageTools(
      envelope([{ ...wireTool, risk: 'mystery' }]),
    );
    expect(badRisk.status).toBe('invalid');

    const duplicate = await discoverPageTools(envelope([wireTool, wireTool]));
    expect(duplicate.status).toBe('invalid');

    const badSchema = await discoverPageTools(
      envelope([{ ...wireTool, inputSchemaJson: '!unserializable' }]),
    );
    expect(badSchema.status).toBe('invalid');

    const nonObjectSchema = await discoverPageTools(
      envelope([{ ...wireTool, inputSchemaJson: '[1,2]' }]),
    );
    expect(nonObjectSchema.status).toBe('invalid');

    const tooMany = await discoverPageTools(
      envelope(
        Array.from({ length: 17 }, (_, index) => ({
          ...wireTool,
          name: `tool_${index}`,
        })),
      ),
    );
    expect(tooMany.status).toBe('invalid');
  });

  it('returns validated tools with parsed schemas', async () => {
    const result = await discoverPageTools(
      fakeInvoke({
        present: true,
        version: 1,
        sessionId: 'session-9',
        tools: [
          wireTool,
          {
            name: 'purge_inventory',
            description: 'Delete everything.',
            risk: 'destructive',
          },
        ],
      }),
    );

    expect(result).toEqual({
      status: 'ok',
      sessionId: 'session-9',
      tools: [
        {
          name: 'inventory_lookup',
          description: 'Look up stock levels.',
          risk: 'observe',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'purge_inventory',
          description: 'Delete everything.',
          risk: 'destructive',
        },
      ],
    });
  });
});

describe('callPageTool', () => {
  const input = {
    name: 'inventory_lookup',
    argumentsJson: '{"keyword":"gizmo"}',
    sessionId: 'session-9',
  };

  it('maps invoke failures and malformed wire results', async () => {
    const rejecting: BoundMainWorldInvoke = vi
      .fn()
      .mockRejectedValue(new Error('tab gone'));
    expect(await callPageTool(rejecting, input)).toEqual({
      ok: false,
      code: 'CALL_FAILED',
      message: 'tab gone',
    });
    expect(await callPageTool(fakeInvoke({ weird: 1 }), input)).toMatchObject({
      ok: false,
      code: 'INVALID_RESULT',
    });
  });

  it('passes through page error codes', async () => {
    expect(
      await callPageTool(
        fakeInvoke({ ok: false, code: 'STALE_TOOLS', message: 'stale' }),
        input,
      ),
    ).toEqual({ ok: false, code: 'STALE_TOOLS', message: 'stale' });
  });

  it('re-canonicalizes successful results and rejects non-JSON payloads', async () => {
    expect(
      await callPageTool(
        fakeInvoke({ ok: true, resultJson: '{"a": 1 }' }),
        input,
      ),
    ).toEqual({ ok: true, resultJson: '{"a":1}' });
    expect(
      await callPageTool(
        fakeInvoke({ ok: true, resultJson: 'not-json{' }),
        input,
      ),
    ).toMatchObject({ ok: false, code: 'INVALID_RESULT' });
  });

  it('sends the declared limits to the MAIN world call', async () => {
    const invoke = fakeInvoke({ ok: true, resultJson: '1' });
    await callPageTool(invoke, input);
    expect(invoke).toHaveBeenCalledWith(callPageToolInMain, [
      'inventory_lookup',
      '{"keyword":"gizmo"}',
      'session-9',
      10_000,
      32_768,
    ]);
  });
});
