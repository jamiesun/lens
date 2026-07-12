import { z } from 'zod';
import { AGENT_SETTINGS_BOUNDS } from '../protocol/agent-settings';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: {
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface AssistantTurn {
  content: string | null;
  toolCalls: ToolCall[];
}

export class ModelError extends Error {
  constructor(
    readonly code: 'HTTP_ERROR' | 'INVALID_RESPONSE' | 'NETWORK_ERROR',
    message: string,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

const MAX_COMPLETION_FIELD_CHARS =
  AGENT_SETTINGS_BOUNDS.maxOutputTokens.max * 4;

const CompletionResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().max(MAX_COMPLETION_FIELD_CHARS).nullish(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().min(1).max(200),
                type: z.literal('function'),
                function: z.object({
                  name: z.string().min(1).max(100),
                  arguments: z.string().max(MAX_COMPLETION_FIELD_CHARS),
                }),
              }),
            )
            .max(16)
            .nullish(),
        }),
      }),
    )
    .min(1),
});

async function readLimitedText(
response: Response,
maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
if (!response.body) {
  return { text: '', truncated: false };
}

const reader = response.body.getReader();
const chunks: Uint8Array[] = [];
let total = 0;

while (true) {
  const { done, value } = await reader.read();
  if (done) {
    break;
  }

  const remaining = maxBytes - total;
  if (value.byteLength > remaining) {
    if (remaining > 0) {
      chunks.push(value.subarray(0, remaining));
      total += remaining;
    }
    await reader.cancel();
    return {
      text: new TextDecoder().decode(joinChunks(chunks, total)),
      truncated: true,
    };
  }

  chunks.push(value);
  total += value.byteLength;
}

return {
  text: new TextDecoder().decode(joinChunks(chunks, total)),
  truncated: false,
};
}

function joinChunks(chunks: Uint8Array[], total: number): Uint8Array {
const combined = new Uint8Array(total);
let offset = 0;
for (const chunk of chunks) {
  combined.set(chunk, offset);
  offset += chunk.byteLength;
}
return combined;
}

export interface CompletionRequest {
  baseUrl: string;
  model: string;
  apiKey: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

export async function chatComplete(
  request: CompletionRequest,
): Promise<AssistantTurn> {
  const endpoint = new URL(
    'v1/chat/completions',
    request.baseUrl.endsWith('/') ? request.baseUrl : `${request.baseUrl}/`,
  );
  const fetchFn = request.fetchFn ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  const abortFromCaller = () => controller.abort(request.signal?.reason);
  request.signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        tools: request.tools,
        ...(request.maxOutputTokens !== undefined && {
          max_tokens: request.maxOutputTokens,
        }),
        stream: false,
      }),
    });

    if (!response.ok) {
      const body = await readLimitedText(response, 16_384);
      const detail = body.text.slice(0, 300);
      throw new ModelError(
        'HTTP_ERROR',
        `Model provider responded ${response.status}${detail ? `: ${detail}${body.truncated ? '…' : ''}` : ''}`,
      );
    }

    const body = await readLimitedText(response, 1_048_576);
    if (body.truncated) {
      throw new ModelError(
        'INVALID_RESPONSE',
        'Model provider response exceeded the 1 MiB limit.',
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body.text);
    } catch (error) {
      if (controller.signal.aborted) {
        throw error;
      }
      throw new ModelError(
        'INVALID_RESPONSE',
        'Model provider returned a non-JSON response.',
      );
    }

    const parsed = CompletionResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ModelError(
        'INVALID_RESPONSE',
        'Model provider returned an unrecognized completion shape.',
      );
    }

    const message = parsed.data.choices[0]!.message;
    return {
      content: message.content ?? null,
      toolCalls: (message.tool_calls ?? []).map((call) => ({
        id: call.id,
        name: call.function.name,
        arguments: call.function.arguments,
      })),
    };
  } catch (error) {
    if (error instanceof ModelError) {
      throw error;
    }
    throw new ModelError(
      'NETWORK_ERROR',
      controller.signal.aborted
        ? request.signal?.aborted
          ? 'Model request cancelled.'
          : 'Model request timed out after 25 seconds.'
        : error instanceof Error
          ? error.message
          : String(error),
    );
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener('abort', abortFromCaller);
  }
}
