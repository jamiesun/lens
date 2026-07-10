import { describe, expect, it, vi } from 'vitest';
import {
  runAgentGoal,
  type AgentDependencies,
} from '../../src/background/agent-runtime';
import { VaultError } from '../../src/background/secret-vault';
import type { AgentEvent } from '../../src/protocol/agent-events';
import type { PageSnapshot } from '../../src/protocol/page-snapshot';

const snapshot: PageSnapshot = {
  version: 1,
  snapshotId: 'snapshot_1',
  generation: 1,
  capturedAt: '2026-07-10T14:00:00.000Z',
  url: 'https://app.example.test/customers/new',
  title: 'Create customer',
  route: '/customers/new',
  headings: [],
  forms: [
    {
      nodeId: 'node_form',
      formId: 'customer-create',
      fields: [
        {
          nodeId: 'node_name',
          role: 'textbox',
          label: 'Name',
          name: 'name',
          fieldType: 'text',
          sensitive: false,
          hasValue: false,
          visible: true,
        },
      ],
      submitActions: [],
      validationState: 'valid',
    },
  ],
  tables: [],
  actions: [],
  alerts: [],
};

function dependencies(
  overrides: Partial<AgentDependencies> = {},
): AgentDependencies {
  return {
    vault: {
      readCredentials: vi.fn().mockResolvedValue({
        provider: {
          baseUrl: 'https://api.example.test/',
          model: 'test-model',
        },
        apiKey: 'sk-test',
      }),
    },
    runSnapshot: vi.fn().mockResolvedValue({
      type: 'lens.page.snapshot.response',
      requestId: 'snapshot-request',
      ok: true,
      snapshot,
    }),
    runFill: vi.fn().mockResolvedValue({
      type: 'lens.page.fill.response',
      requestId: 'fill-request',
      ok: true,
      result: {
        snapshotId: 'snapshot_1',
        generation: 1,
        outcomes: [{ nodeId: 'node_name', status: 'filled' }],
      },
    }),
    complete: vi
      .fn()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'call_1',
            name: 'page_form_fill',
            arguments: JSON.stringify({
              fields: [{ nodeId: 'node_name', value: 'Grace' }],
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        content: '已填写姓名；尚未提交。',
        toolCalls: [],
      }),
    ...overrides,
  };
}

describe('runAgentGoal', () => {
  it('runs snapshot -> model tool call -> fill -> final reply', async () => {
    const deps = dependencies();
    const events: AgentEvent[] = [];

    await runAgentGoal('Fill the name', deps, (event) => events.push(event));

    expect(deps.runFill).toHaveBeenCalledWith({
      snapshotId: 'snapshot_1',
      generation: 1,
      fields: [{ nodeId: 'node_name', value: 'Grace' }],
    });
    expect(events).toContainEqual({
      kind: 'tool',
      tool: 'page.form.fill',
      status: 'completed',
      detail: '1/1 fields filled',
      affected: 1,
    });
    expect(events).toContainEqual({
      kind: 'assistant',
      text: '已填写姓名；尚未提交。',
    });
    expect(events.at(-1)).toEqual({ kind: 'done' });
  });

  it('never calls the model while the vault is locked', async () => {
    const deps = dependencies({
      vault: {
        readCredentials: vi
          .fn()
          .mockRejectedValue(new VaultError('LOCKED', 'locked')),
      },
    });
    const events: AgentEvent[] = [];

    await runAgentGoal('Fill the name', deps, (event) => events.push(event));

    expect(deps.complete).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        kind: 'error',
        code: 'VAULT_LOCKED',
        message: 'Unlock the vault before running a goal.',
      },
    ]);
  });

  it('rejects invalid model tool arguments without executing a fill', async () => {
    const deps = dependencies({
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_bad',
              name: 'page_form_fill',
              arguments: '{"fields":"not-an-array"}',
            },
          ],
        })
        .mockResolvedValueOnce({
          content: '无法执行无效参数。',
          toolCalls: [],
        }),
    });
    const events: AgentEvent[] = [];

    await runAgentGoal('Fill the name', deps, (event) => events.push(event));

    expect(deps.runFill).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      kind: 'tool',
      tool: 'page.form.fill',
      status: 'failed',
      detail: 'Invalid tool arguments from model',
    });
    expect(events.at(-1)).toEqual({ kind: 'done' });
  });

  it('rejects an oversized tool batch before any side effect', async () => {
    const deps = dependencies({
      complete: vi.fn().mockResolvedValue({
        content: null,
        toolCalls: Array.from({ length: 5 }, (_, index) => ({
          id: `call_${index}`,
          name: 'page_form_fill',
          arguments: JSON.stringify({
            fields: [{ nodeId: 'node_name', value: `value-${index}` }],
          }),
        })),
      }),
    });
    const events: AgentEvent[] = [];

    await runAgentGoal('Fill repeatedly', deps, (event) => events.push(event));

    expect(deps.runFill).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({
      kind: 'error',
      code: 'STEP_LIMIT',
      message: expect.stringContaining('Tool-call budget exceeded'),
    });
  });

  it('stops remaining writes after cancellation while preserving the first receipt', async () => {
    const controller = new AbortController();
    const deps = dependencies({
      complete: vi.fn().mockResolvedValue({
        content: null,
        toolCalls: [
          {
            id: 'call_1',
            name: 'page_form_fill',
            arguments: JSON.stringify({
              fields: [{ nodeId: 'node_name', value: 'first' }],
            }),
          },
          {
            id: 'call_2',
            name: 'page_form_fill',
            arguments: JSON.stringify({
              fields: [{ nodeId: 'node_name', value: 'second' }],
            }),
          },
        ],
      }),
      runFill: vi.fn().mockImplementation(async () => {
        controller.abort();
        return {
          type: 'lens.page.fill.response',
          requestId: 'fill-request',
          ok: true,
          result: {
            snapshotId: 'snapshot_1',
            generation: 1,
            outcomes: [{ nodeId: 'node_name', status: 'filled' }],
          },
        };
      }),
    });
    const events: AgentEvent[] = [];

    await runAgentGoal(
      'Fill twice',
      deps,
      (event) => events.push(event),
      controller.signal,
    );

    expect(deps.runFill).toHaveBeenCalledOnce();
    expect(events).toContainEqual({
      kind: 'tool',
      tool: 'page.form.fill',
      status: 'completed',
      detail: '1/1 fields filled',
      affected: 1,
    });
    expect(events.at(-1)).toEqual({
      kind: 'error',
      code: 'CANCELLED',
      message: 'Run cancelled.',
    });
  });

  it('truncates oversized final replies to the event protocol limit', async () => {
    const deps = dependencies({
      complete: vi.fn().mockResolvedValue({
        content: 'x'.repeat(10_000),
        toolCalls: [],
      }),
    });
    const events: AgentEvent[] = [];

    await runAgentGoal('Summarize', deps, (event) => events.push(event));

    const reply = events.find((event) => event.kind === 'assistant');
    expect(reply).toMatchObject({ kind: 'assistant' });
    expect(reply?.kind === 'assistant' ? reply.text : '').toHaveLength(8_000);
    expect(events.at(-1)).toEqual({ kind: 'done' });
  });
});
