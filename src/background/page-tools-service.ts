import {
  MAX_PAGE_TOOLS,
  MAX_PAGE_TOOL_RESULT_CHARS,
  PAGE_TOOLS_PROTOCOL_VERSION,
  PAGE_TOOL_CALL_TIMEOUT_MS,
  PageToolCallWireResultSchema,
  PageToolWireDescriptorSchema,
  PageToolsWireEnvelopeSchema,
  type PageToolCallErrorCode,
  type ValidatedPageTool,
} from '../protocol/page-tools';

/**
 * Runs a self-contained function inside the pinned tab's MAIN world and
 * returns its structured-clone result. Implemented in the background with
 * `scripting.executeScript({ world: 'MAIN' })`.
 */
export type BoundMainWorldInvoke = <Args extends readonly (string | number)[]>(
  func: (...args: Args) => unknown,
  args: Args,
) => Promise<unknown>;

export type PageToolsDiscovery =
  | { status: 'absent' }
  | { status: 'unavailable'; detail: string }
  | { status: 'incompatible'; version: number }
  | { status: 'invalid'; detail: string }
  | { status: 'ok'; sessionId: string; tools: ValidatedPageTool[] };

export type PageToolCallOutcome =
  | { ok: true; resultJson: string }
  | {
      ok: false;
      code: PageToolCallErrorCode | 'CALL_FAILED' | 'INVALID_RESULT';
      message: string;
    };

interface PageToolsGlobal {
  version?: unknown;
  sessionId?: unknown;
  tools?: unknown;
}

type PageToolsWindow = typeof globalThis & {
  __lensPageToolsV1?: PageToolsGlobal;
};

/**
 * MAIN-world reader. Serialized by `scripting.executeScript`, so it must not
 * reference anything outside its own body. It normalizes the page registry
 * into a JSON-safe envelope; all trust decisions happen in the background.
 */
export function readPageToolsInMain(): unknown {
  const registry = (globalThis as PageToolsWindow).__lensPageToolsV1;
  if (registry === null || typeof registry !== 'object') {
    return { present: false };
  }

  try {
    if (
      typeof registry.sessionId !== 'string' ||
      registry.sessionId.length === 0 ||
      registry.sessionId.length > 128
    ) {
      // Bind a session id lazily so stale calls fail after a reload even
      // when the page did not generate one itself.
      registry.sessionId =
        typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    }

    const toolsRaw = registry.tools;
    const entries: unknown[] =
      toolsRaw instanceof Map
        ? Array.from(toolsRaw.values())
        : toolsRaw !== null && typeof toolsRaw === 'object'
          ? Object.values(toolsRaw)
          : [];

    const tools = entries.slice(0, 64).map((entry) => {
      const tool =
        entry !== null && typeof entry === 'object'
          ? (entry as Record<string, unknown>)
          : {};
      let inputSchemaJson: string | undefined;
      if (tool.inputSchema !== undefined) {
        try {
          inputSchemaJson = JSON.stringify(tool.inputSchema);
        } catch {
          // Marker that fails JSON.parse in the background, so a poisoned
          // schema invalidates the registry instead of vanishing silently.
          inputSchemaJson = '!unserializable';
        }
        if (typeof inputSchemaJson !== 'string') {
          inputSchemaJson = '!unserializable';
        }
      }
      return {
        name: typeof tool.name === 'string' ? tool.name : '',
        description:
          typeof tool.description === 'string' ? tool.description : '',
        risk: typeof tool.risk === 'string' ? tool.risk : '',
        ...(inputSchemaJson === undefined ? {} : { inputSchemaJson }),
      };
    });

    return {
      present: true,
      version: typeof registry.version === 'number' ? registry.version : -1,
      sessionId: registry.sessionId,
      tools,
    };
  } catch {
    return { present: false };
  }
}

/**
 * MAIN-world executor. Also serialized, hence self-contained. Limits are
 * passed as arguments so the module constants stay the single source of
 * truth. A timeout bounds the wait, not the page's own execution.
 */
export function callPageToolInMain(
  name: string,
  argumentsJson: string,
  sessionId: string,
  timeoutMs: number,
  maxResultChars: number,
): unknown {
  const failure = (code: string, message: string) => ({
    ok: false,
    code,
    message,
  });

  const registry = (globalThis as PageToolsWindow).__lensPageToolsV1;
  if (registry === null || typeof registry !== 'object') {
    return failure('NO_REGISTRY', 'The page does not expose Lens tools.');
  }
  if (registry.sessionId !== sessionId) {
    return failure(
      'STALE_TOOLS',
      'The page tools changed after discovery. Rescan before calling again.',
    );
  }

  const toolsRaw = registry.tools;
  const entry: unknown =
    toolsRaw instanceof Map
      ? toolsRaw.get(name)
      : toolsRaw !== null && typeof toolsRaw === 'object'
        ? (toolsRaw as Record<string, unknown>)[name]
        : undefined;
  const tool =
    entry !== null && typeof entry === 'object'
      ? (entry as { execute?: unknown })
      : undefined;
  if (!tool || typeof tool.execute !== 'function') {
    return failure(
      'TOOL_NOT_FOUND',
      `The page does not register a tool named "${name}".`,
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(argumentsJson);
  } catch {
    return failure('INVALID_ARGUMENTS', 'Tool arguments were not valid JSON.');
  }

  const execute = tool.execute as (input: unknown) => unknown;
  return (async () => {
    try {
      const result = await Promise.race([
        Promise.resolve(execute(input)),
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error('__lens_page_tool_timeout__')),
            timeoutMs,
          );
        }),
      ]);

      let resultJson: string | undefined;
      try {
        resultJson = result === undefined ? 'null' : JSON.stringify(result);
      } catch {
        return failure(
          'RESULT_NOT_JSON',
          'The tool result could not be serialized to JSON.',
        );
      }
      if (typeof resultJson !== 'string') {
        return failure(
          'RESULT_NOT_JSON',
          'The tool result could not be serialized to JSON.',
        );
      }
      if (resultJson.length > maxResultChars) {
        return failure(
          'RESULT_TOO_LARGE',
          `The tool result exceeded ${maxResultChars} characters.`,
        );
      }
      return { ok: true, resultJson };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      if (message === '__lens_page_tool_timeout__') {
        return failure('TIMEOUT', `Tool "${name}" timed out.`);
      }
      return failure('EXECUTE_ERROR', message.slice(0, 300) || 'Tool failed.');
    }
  })();
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 300);
  }
  return String(error).slice(0, 300);
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Discovers the page registry and validates every declaration. Any invalid
 * tool rejects the whole registry: a page that cannot describe itself
 * correctly gets no tools at all.
 */
export async function discoverPageTools(
  invoke: BoundMainWorldInvoke,
): Promise<PageToolsDiscovery> {
  let raw: unknown;
  try {
    raw = await invoke(readPageToolsInMain, []);
  } catch (error) {
    return { status: 'unavailable', detail: describeError(error) };
  }

  const envelope = PageToolsWireEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return {
      status: 'invalid',
      detail: 'The page returned an invalid tool registry.',
    };
  }
  if (!envelope.data.present) {
    return { status: 'absent' };
  }
  if (envelope.data.version !== PAGE_TOOLS_PROTOCOL_VERSION) {
    return { status: 'incompatible', version: envelope.data.version };
  }
  if (envelope.data.tools.length > MAX_PAGE_TOOLS) {
    return {
      status: 'invalid',
      detail: `The page registered more than ${MAX_PAGE_TOOLS} tools.`,
    };
  }

  const tools: ValidatedPageTool[] = [];
  const seenNames = new Set<string>();
  for (const rawTool of envelope.data.tools) {
    const parsed = PageToolWireDescriptorSchema.safeParse(rawTool);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        status: 'invalid',
        detail: `Invalid tool declaration: ${issue ? `${issue.path.join('.')}: ${issue.message}` : 'unknown issue'}`.slice(
          0,
          300,
        ),
      };
    }
    if (seenNames.has(parsed.data.name)) {
      return {
        status: 'invalid',
        detail: `Duplicate tool name "${parsed.data.name}".`,
      };
    }
    seenNames.add(parsed.data.name);

    let inputSchema: Record<string, unknown> | undefined;
    if (parsed.data.inputSchemaJson !== undefined) {
      let schemaValue: unknown;
      try {
        schemaValue = JSON.parse(parsed.data.inputSchemaJson);
      } catch {
        return {
          status: 'invalid',
          detail: `Tool "${parsed.data.name}" declared a non-JSON input schema.`,
        };
      }
      if (!isPlainJsonObject(schemaValue)) {
        return {
          status: 'invalid',
          detail: `Tool "${parsed.data.name}" input schema must be a JSON object.`,
        };
      }
      inputSchema = schemaValue;
    }

    tools.push({
      name: parsed.data.name,
      description: parsed.data.description,
      risk: parsed.data.risk,
      ...(inputSchema === undefined ? {} : { inputSchema }),
    });
  }

  return { status: 'ok', sessionId: envelope.data.sessionId, tools };
}

/**
 * Executes one validated page tool. The result is parsed and re-serialized in
 * the background so a page-tampered `JSON.stringify` cannot smuggle non-JSON
 * text into the model transcript.
 */
export async function callPageTool(
  invoke: BoundMainWorldInvoke,
  input: { name: string; argumentsJson: string; sessionId: string },
): Promise<PageToolCallOutcome> {
  let raw: unknown;
  try {
    raw = await invoke(callPageToolInMain, [
      input.name,
      input.argumentsJson,
      input.sessionId,
      PAGE_TOOL_CALL_TIMEOUT_MS,
      MAX_PAGE_TOOL_RESULT_CHARS,
    ]);
  } catch (error) {
    return { ok: false, code: 'CALL_FAILED', message: describeError(error) };
  }

  const parsed = PageToolCallWireResultSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      code: 'INVALID_RESULT',
      message: 'The page returned an invalid tool result.',
    };
  }
  if (!parsed.data.ok) {
    return parsed.data;
  }

  try {
    const value: unknown = JSON.parse(parsed.data.resultJson);
    return { ok: true, resultJson: JSON.stringify(value) ?? 'null' };
  } catch {
    return {
      ok: false,
      code: 'INVALID_RESULT',
      message: 'The page returned non-JSON tool output.',
    };
  }
}
