import { createDocumentElementRegistry } from '../src/content/element-registry';
import { buildPageSnapshot } from '../src/content/page-observer';

export default defineContentScript({
  registration: 'runtime',
  main() {
    const registry = createDocumentElementRegistry();
    return buildPageSnapshot(document, window, registry);
  },
});
