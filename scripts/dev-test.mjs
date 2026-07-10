import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  startFixtureServer,
  stopFixtureServer,
} from '../tests/fixtures/server.mjs';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const fixturePort = 4173;
const { server, url: fixtureOrigin } = await startFixtureServer({
  port: fixturePort,
});
const fixtureUrl = `${fixtureOrigin}/customer-create.html`;
const wxtCli = path.join(repositoryRoot, 'node_modules/wxt/bin/wxt.mjs');

console.info(`\nLens development fixture: ${fixtureUrl}`);
console.info('Starting Chromium with the test-mode extension and hot reload.\n');

const wxtProcess = spawn(process.execPath, [wxtCli, '--mode', 'test'], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    LENS_DEV_TEST_URL: fixtureUrl,
  },
  stdio: 'inherit',
});

let finalized = false;
let requestedExitCode;

async function finalize(exitCode) {
  if (finalized) {
    return;
  }

  finalized = true;
  await stopFixtureServer(server);
  process.exitCode = exitCode;
}

function forwardSignal(signal, exitCode) {
  requestedExitCode = exitCode;
  if (!wxtProcess.killed) {
    wxtProcess.kill(signal);
  }
}

process.once('SIGINT', () => forwardSignal('SIGINT', 130));
process.once('SIGTERM', () => forwardSignal('SIGTERM', 143));

wxtProcess.once('error', (error) => {
  console.error('Lens could not start the WXT development process.', error);
  void finalize(1);
});

wxtProcess.once('exit', (code, signal) => {
  const exitCode =
    requestedExitCode ??
    code ??
    (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  void finalize(exitCode);
});
