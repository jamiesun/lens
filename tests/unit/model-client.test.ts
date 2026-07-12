import { describe, expect, it, vi } from 'vitest';
import {
  chatComplete,
  ModelError,
} from '../../src/background/model-client';

const baseRequest = {
  baseUrl: 'https://api.example.test/openai/',
  model: 'test-model',
  apiKey: 'sk-test',
  messages: [{ role: 'user' as const, content: 'Fill the form' }],
};

describe('chatComplete', () => {
  it('sends an OpenAI-compatible request and parses tool calls', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'page_form_fill',
                      arguments: '{"fields":[]}',
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await chatComplete({
      ...baseRequest,
      fetchFn,
    });

    expect(result).toEqual({
      content: null,
      toolCalls: [
        {
          id: 'call_1',
          name: 'page_form_fill',
          arguments: '{"fields":[]}',
        },
      ],
    });
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe(
      'https://api.example.test/openai/v1/chat/completions',
    );
    expect(init.headers.authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'test-model',
      stream: false,
    });
    expect(JSON.parse(init.body)).not.toHaveProperty('max_tokens');
  });

  it('sends max_tokens only when an output cap is configured', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
        }),
        { status: 200 },
      ),
    );

    await chatComplete({
      ...baseRequest,
      maxOutputTokens: 512,
      fetchFn,
    });

    const [, init] = fetchFn.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({ max_tokens: 512 });
  });

  it('accepts response content within the largest configurable output cap', async () => {
    const content = 'x'.repeat(20_001);
    const result = await chatComplete({
      ...baseRequest,
      maxOutputTokens: 32_768,
      fetchFn: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content } }],
          }),
          { status: 200 },
        ),
      ),
    });

    expect(result.content).toHaveLength(20_001);
  });

  it('surfaces HTTP failures without a success-shaped fallback', async () => {
    await expect(
      chatComplete({
        ...baseRequest,
        fetchFn: vi
          .fn()
          .mockResolvedValue(new Response('quota exceeded', { status: 429 })),
      }),
    ).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      message: expect.stringContaining('429'),
    } satisfies Partial<ModelError>);
  });

  it('rejects malformed completion responses', async () => {
    await expect(
      chatComplete({
        ...baseRequest,
        fetchFn: vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ choices: [] }), { status: 200 }),
          ),
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    } satisfies Partial<ModelError>);
  });

  it('rejects provider responses with an excessive tool-call batch', async () => {
    await expect(
      chatComplete({
        ...baseRequest,
        fetchFn: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: null,
                    tool_calls: Array.from({ length: 17 }, (_, index) => ({
                      id: `call_${index}`,
                      type: 'function',
                      function: { name: 'page_snapshot', arguments: '{}' },
                    })),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    } satisfies Partial<ModelError>);
  });

  it('aborts parsing when the response body exceeds one MiB', async () => {
    await expect(
      chatComplete({
        ...baseRequest,
        fetchFn: vi
          .fn()
          .mockResolvedValue(
            new Response('x'.repeat(1_048_577), { status: 200 }),
          ),
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      message: expect.stringContaining('1 MiB'),
    } satisfies Partial<ModelError>);
  });
});
