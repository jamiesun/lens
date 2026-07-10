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

    if (requestUrl.pathname === '/customer-create.html') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      });
      const fixtureStream = createReadStream(
        path.join(fixturesDirectory, 'customer-create.html'),
      );
      fixtureStream.on('error', (error) => {
        console.error('Lens fixture server could not read the test page.', error);
        response.destroy(error);
      });
      fixtureStream.pipe(response);
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
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
