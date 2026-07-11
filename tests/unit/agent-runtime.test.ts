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
  actions: [
    {
      nodeId: 'node_solve',
      role: 'button',
      label: '看看电脑怎么解',
      disabled: false,
    },
    {
      nodeId: 'node_peg',
      role: 'clickable',
      label: 'div.peg[data-peg="0"]',
      disabled: false,
    },
  ],
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
    runClick: vi.fn().mockResolvedValue({
      type: 'lens.page.click.response',
      requestId: 'click-request',
      ok: true,
      result: {
        snapshotId: 'snapshot_1',
        generation: 1,
        outcome: { nodeId: 'node_peg', status: 'clicked' },
      },
    }),
    runScreenshot: vi.fn().mockResolvedValue({
      type: 'lens.page.screenshot.response',
      requestId: 'screenshot-request',
      ok: true,
      screenshot: {
        dataUrl: 'data:image/png;base64,AA==',
        filename: 'lens-viewport.png',
        mimeType: 'image/png',
        width: 800,
        height: 600,
        mode: 'viewport',
        truncated: false,
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

  it('routes page_click with runtime-bound snapshot identity', async () => {
    const deps = dependencies({
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_click',
              name: 'page_click',
              arguments: JSON.stringify({ nodeId: 'node_peg' }),
            },
          ],
        })
        .mockResolvedValueOnce({
          content: '已点击左侧柱子。',
          toolCalls: [],
        }),
    });
    const events: AgentEvent[] = [];

    await runAgentGoal('点击左边的柱子', deps, (event) => events.push(event));

    expect(deps.runClick).toHaveBeenCalledWith({
      snapshotId: 'snapshot_1',
      generation: 1,
      nodeId: 'node_peg',
    });
    expect(events).toContainEqual({
      kind: 'tool',
      tool: 'page.click',
      status: 'completed',
      detail: 'Clicked div.peg[data-peg="0"]',
      affected: 1,
    });
    expect(events.at(-1)).toEqual({ kind: 'done' });
  });

  it('rejects invalid page_click arguments without clicking', async () => {
    const deps = dependencies({
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_bad_click',
              name: 'page_click',
              arguments: '{"x": 120, "y": 240}',
            },
          ],
        })
        .mockResolvedValueOnce({
          content: '坐标点击不受支持。',
          toolCalls: [],
        }),
    });
    const events: AgentEvent[] = [];

    await runAgentGoal('点击坐标', deps, (event) => events.push(event));

    expect(deps.runClick).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      kind: 'tool',
      tool: 'page.click',
      status: 'failed',
      detail: 'Invalid tool arguments from model',
    });
    expect(events.at(-1)).toEqual({ kind: 'done' });
  });

  it('surfaces a rejected click outcome as a failed tool event', async () => {
    const deps = dependencies({
      runClick: vi.fn().mockResolvedValue({
        type: 'lens.page.click.response',
        requestId: 'click-request',
        ok: true,
        result: {
          snapshotId: 'snapshot_1',
          generation: 1,
          outcome: {
            nodeId: 'node_solve',
            status: 'rejected',
            reason: 'submit-blocked',
          },
        },
      }),
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_blocked_click',
              name: 'page_click',
              arguments: JSON.stringify({ nodeId: 'node_solve' }),
            },
          ],
        })
        .mockResolvedValueOnce({
          content: '提交按钮被运行时策略拒绝。',
          toolCalls: [],
        }),
    });
    const events: AgentEvent[] = [];

    await runAgentGoal('提交表单', deps, (event) => events.push(event));

    expect(events).toContainEqual({
      kind: 'tool',
      tool: 'page.click',
      status: 'failed',
      detail: 'Rejected (submit-blocked): 看看电脑怎么解',
    });
    expect(events.at(-1)).toEqual({ kind: 'done' });
  });

  it('rejects an oversized tool batch before any side effect', async () => {
    const deps = dependencies({
      complete: vi.fn().mockResolvedValue({
        content: null,
        toolCalls: Array.from({ length: 7 }, (_, index) => ({
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

  it('routes full-page screenshot requests and emits a downloadable image', async () => {
    const deps = dependencies({
      runScreenshot: vi.fn().mockResolvedValue({
        type: 'lens.page.screenshot.response',
        requestId: 'screenshot-request',
        ok: true,
        screenshot: {
          dataUrl: 'data:image/jpeg;base64,AA==',
          filename: 'lens-full-page.jpg',
          mimeType: 'image/jpeg',
          width: 800,
          height: 2_400,
          mode: 'full-page',
          truncated: false,
        },
      }),
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          content: null,
          toolCalls: [
            {
              id: 'call_screenshot',
              name: 'page_screenshot',
              arguments: '{"mode":"full-page"}',
            },
          ],
        })
        .mockResolvedValueOnce({
          content: '长截图已生成。',
          toolCalls: [],
        }),
    });
    const events: AgentEvent[] = [];

    await runAgentGoal('截取整页长图', deps, (event) => events.push(event));

    expect(deps.runScreenshot).toHaveBeenCalledWith('full-page', undefined);
    expect(events).toContainEqual({
      kind: 'screenshot',
      screenshot: {
        dataUrl: 'data:image/jpeg;base64,AA==',
        filename: 'lens-full-page.jpg',
        mimeType: 'image/jpeg',
        width: 800,
        height: 2_400,
        mode: 'full-page',
        truncated: false,
      },
    });
    expect(events.at(-1)).toEqual({ kind: 'done' });
  });
});
