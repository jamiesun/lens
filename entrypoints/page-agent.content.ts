import { installPageAgent } from '../src/content/page-agent';

export default defineContentScript({
  registration: 'runtime',
  main() {
    return installPageAgent();
  },
});
