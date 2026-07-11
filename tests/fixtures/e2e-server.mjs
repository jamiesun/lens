import { startFixtureServer } from './server.mjs';

const { url } = await startFixtureServer({ port: 4174 });
console.info(`Lens E2E fixture ready at ${url}`);
