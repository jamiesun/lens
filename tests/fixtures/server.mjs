import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const fixturesDirectory = path.dirname(fileURLToPath(import.meta.url));

export function createFixtureServer() {
  return createServer((request, response) => {
    const requestUrl = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? '127.0.0.1'}`,
    );

    if (requestUrl.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
      return;
    }

    const staticPages = new Set([
      '/customer-create.html',
      '/click-playground.html',
    ]);
    if (staticPages.has(requestUrl.pathname)) {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      });
      const fixtureStream = createReadStream(
        path.join(fixturesDirectory, requestUrl.pathname.slice(1)),
      );
      fixtureStream.on('error', (error) => {
        console.error('Lens fixture server could not read the test page.', error);
        response.destroy(error);
      });
      fixtureStream.pipe(response);
      return;
    }

    if (
      requestUrl.pathname === '/mock-openai/v1/chat/completions' &&
      request.method === 'POST'
    ) {
      void respondWithMockCompletion(request, response);
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
}

async function respondWithMockCompletion(request, response) {
  try {
    if (request.headers.authorization !== 'Bearer lens-test-key') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'invalid test credential' }));
      return;
    }

    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const hasToolResult = messages.some((message) => message.role === 'tool');
    const userMessages = messages.filter((message) => message.role === 'user');
    const userMessage = userMessages.at(-1);

    if (
      !hasToolResult &&
      typeof userMessage?.content === 'string' &&
      userMessage.content.includes('ATTACHMENT_TEST')
    ) {
      const receivedAttachment =
        userMessage.content.includes('"name":"brief.md"') &&
        userMessage.content.includes('ORBIT-42');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: receivedAttachment
                  ? '附件中的项目代号是 ORBIT-42。'
                  : '没有收到附件内容。',
              },
            },
          ],
        }),
      );
      return;
    }

    if (
      !hasToolResult &&
      typeof userMessage?.content === 'string' &&
      userMessage.content.includes('记住暗号：海蓝')
    ) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ message: { content: '记住了：海蓝。' } }],
        }),
      );
      return;
    }

    if (
      !hasToolResult &&
      typeof userMessage?.content === 'string' &&
      userMessage.content.includes('刚才的暗号是什么')
    ) {
      const hasHistory = userMessages
        .slice(0, -1)
        .some(
          (message) =>
            typeof message.content === 'string' &&
            message.content.includes('记住暗号：海蓝'),
        );
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: hasHistory ? '刚才的暗号是海蓝。' : '没有收到上文。',
              },
            },
          ],
        }),
      );
      return;
    }

    if (
      !hasToolResult &&
      typeof userMessage?.content === 'string' &&
      userMessage.content.includes('SLOW_AGENT_TEST')
    ) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      if (response.destroyed) {
        return;
      }
    }

    if (
      !hasToolResult &&
      typeof userMessage?.content === 'string' &&
      userMessage.content.includes('SCREENSHOT_FULL')
    ) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_full_screenshot',
                    type: 'function',
                    function: {
                      name: 'page_screenshot',
                      arguments: JSON.stringify({ mode: 'full-page' }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
      return;
    }

    if (hasToolResult) {
      const isClickGoal =
        typeof userMessage?.content === 'string' &&
        userMessage.content.includes('CLICK_PLAYGROUND');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: isClickGoal
                  ? '已点击左侧柱子；计数已增加。'
                  : '已填写客户姓名和手机号；表单尚未提交。',
              },
            },
          ],
        }),
      );
      return;
    }

    const snapshotMatch =
      typeof userMessage?.content === 'string'
        ? /Current page snapshot:\n([\s\S]+)\n\nGoal:/.exec(
            userMessage.content,
          )
        : undefined;
    const snapshot = snapshotMatch?.[1]
      ? JSON.parse(snapshotMatch[1])
      : undefined;

    if (
      typeof userMessage?.content === 'string' &&
      userMessage.content.includes('CLICK_PLAYGROUND')
    ) {
      const clickable = snapshot?.actions?.find(
        (action) =>
          action.role === 'clickable' && action.label.includes('data-peg'),
      );
      if (!clickable?.nodeId) {
        response.writeHead(422, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ error: 'clickable peg missing from snapshot' }),
        );
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_click_peg',
                    type: 'function',
                    function: {
                      name: 'page_click',
                      arguments: JSON.stringify({ nodeId: clickable.nodeId }),
                    },
                  },
                ],
              },
            },
          ],
        }),
      );
      return;
    }

    const fields = snapshot?.forms?.flatMap((form) => form.fields) ?? [];
    const nameField = fields.find((field) => field.name === 'name');
    const phoneField = fields.find((field) => field.name === 'phone');

    if (!nameField?.nodeId || !phoneField?.nodeId) {
      response.writeHead(422, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'snapshot fields missing' }));
      return;
    }

    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_fill_customer',
                  type: 'function',
                  function: {
                    name: 'page_form_fill',
                    arguments: JSON.stringify({
                      fields: [
                        {
                          nodeId: nameField.nodeId,
                          value: 'Agent Grace',
                        },
                        {
                          nodeId: phoneField.nodeId,
                          value: '13900002222',
                        },
                      ],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

export async function startFixtureServer({
  host = '0.0.0.0',
  port = 4173,
} = {}) {
  const server = createFixtureServer();

  await new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off('listening', handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off('error', handleError);
      resolve();
    };

    server.once('error', handleError);
    server.once('listening', handleListening);
    server.listen(port, host);
  });

  return {
    server,
    url: `http://127.0.0.1:${port}`,
  };
}

export async function stopFixtureServer(server) {
  if (!server.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

const entrypointPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;

if (entrypointPath === import.meta.url) {
  const port = Number.parseInt(process.env.LENS_FIXTURE_PORT ?? '4173', 10);
  const { url } = await startFixtureServer({ port });
  console.info(`Lens fixture ready at ${url}/customer-create.html`);
}
