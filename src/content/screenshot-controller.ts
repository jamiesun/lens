interface HiddenElement {
  element: HTMLElement;
  visibility: string;
  priority: string;
}

interface ScreenshotSession {
  id: string;
  originalX: number;
  originalY: number;
  htmlScrollBehavior: string;
  bodyScrollBehavior?: string;
  htmlScrollSnapType: string;
  htmlScrollSnapPriority: string;
  bodyScrollSnapType?: string;
  bodyScrollSnapPriority?: string;
  hiddenElements: HiddenElement[];
  scrollbarStyle: HTMLStyleElement;
}

interface ScreenshotGlobal {
  __lensScreenshotSessionV1?: ScreenshotSession;
}

function createSessionId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return `capture_${Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')}`;
}

function screenshotGlobal(): typeof globalThis & ScreenshotGlobal {
  return globalThis as typeof globalThis & ScreenshotGlobal;
}

function documentDimensions(document: Document) {
  const html = document.documentElement;
  const body = document.body;
  return {
    width: Math.max(
      html.scrollWidth,
      html.offsetWidth,
      html.clientWidth,
      body?.scrollWidth ?? 0,
      body?.offsetWidth ?? 0,
    ),
    height: Math.max(
      html.scrollHeight,
      html.offsetHeight,
      html.clientHeight,
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
    ),
  };
}

export function prepareScreenshot(
  document: Document,
  view: Window,
  sessionId: string,
) {
  const existing = screenshotGlobal().__lensScreenshotSessionV1;
  if (existing) {
    restoreSession(existing, view);
  }

  const scrollbarStyle = document.createElement('style');
  scrollbarStyle.dataset.lensCapture = 'scrollbars';
  scrollbarStyle.textContent =
    '*::-webkit-scrollbar{display:none!important}html{scrollbar-width:none!important}';
  document.documentElement.append(scrollbarStyle);

  const session: ScreenshotSession = {
    id: sessionId || createSessionId(),
    originalX: Math.round(view.scrollX),
    originalY: Math.round(view.scrollY),
    htmlScrollBehavior: document.documentElement.style.scrollBehavior,
    bodyScrollBehavior: document.body?.style.scrollBehavior,
    htmlScrollSnapType:
      document.documentElement.style.getPropertyValue('scroll-snap-type'),
    htmlScrollSnapPriority:
      document.documentElement.style.getPropertyPriority('scroll-snap-type'),
    bodyScrollSnapType:
      document.body?.style.getPropertyValue('scroll-snap-type'),
    bodyScrollSnapPriority:
      document.body?.style.getPropertyPriority('scroll-snap-type'),
    hiddenElements: [],
    scrollbarStyle,
  };
  document.documentElement.style.scrollBehavior = 'auto';
  document.documentElement.style.setProperty(
    'scroll-snap-type',
    'none',
    'important',
  );
  if (document.body) {
    document.body.style.scrollBehavior = 'auto';
    document.body.style.setProperty('scroll-snap-type', 'none', 'important');
  }
  screenshotGlobal().__lensScreenshotSessionV1 = session;

  const dimensions = documentDimensions(document);
  return {
    ok: true as const,
    sessionId: session.id,
    documentWidth: Math.round(dimensions.width),
    documentHeight: Math.round(dimensions.height),
    viewportWidth: Math.round(view.innerWidth),
    viewportHeight: Math.round(view.innerHeight),
  };
}

export async function scrollScreenshot(
  document: Document,
  view: Window,
  input: { sessionId: string; y: number; hideFixed: boolean },
) {
  const session = screenshotGlobal().__lensScreenshotSessionV1;
  if (!session || session.id !== input.sessionId) {
    return { ok: false as const, code: 'STALE_CAPTURE' };
  }

  if (input.hideFixed) {
    const alreadyHidden = new Set(
      session.hiddenElements.map((hidden) => hidden.element),
    );
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      const style = view.getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      if (
        !alreadyHidden.has(element) &&
        (style.position === 'fixed' || style.position === 'sticky') &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        bounds.bottom > 0 &&
        bounds.top < view.innerHeight
      ) {
        session.hiddenElements.push({
          element,
          visibility: element.style.getPropertyValue('visibility'),
          priority: element.style.getPropertyPriority('visibility'),
        });
        element.style.setProperty('visibility', 'hidden', 'important');
      }
      if (session.hiddenElements.length >= 2_000) {
        break;
      }
    }
  }

  view.scrollTo({ left: 0, top: input.y, behavior: 'instant' });
  await nextPaint(view);
  return {
    ok: true as const,
    scrollY: Math.max(0, Math.round(view.scrollY)),
  };
}

export async function restoreScreenshot(
  view: Window,
  sessionId: string,
) {
  const session = screenshotGlobal().__lensScreenshotSessionV1;
  if (!session || session.id !== sessionId) {
    return { ok: false as const, code: 'STALE_CAPTURE' };
  }

  restoreSession(session, view);
  delete screenshotGlobal().__lensScreenshotSessionV1;
  await nextPaint(view);
  return { ok: true as const };
}

function restoreSession(session: ScreenshotSession, view: Window) {
  for (const hidden of session.hiddenElements) {
    if (hidden.visibility) {
      hidden.element.style.setProperty(
        'visibility',
        hidden.visibility,
        hidden.priority,
      );
    } else {
      hidden.element.style.removeProperty('visibility');
    }
  }
  session.scrollbarStyle.remove();
  view.document.documentElement.style.scrollBehavior =
    session.htmlScrollBehavior;
  restoreStyleProperty(
    view.document.documentElement,
    'scroll-snap-type',
    session.htmlScrollSnapType,
    session.htmlScrollSnapPriority,
  );
  if (view.document.body && session.bodyScrollBehavior !== undefined) {
    view.document.body.style.scrollBehavior = session.bodyScrollBehavior;
    restoreStyleProperty(
      view.document.body,
      'scroll-snap-type',
      session.bodyScrollSnapType ?? '',
      session.bodyScrollSnapPriority ?? '',
    );
  }
  view.scrollTo({
    left: session.originalX,
    top: session.originalY,
    behavior: 'instant',
  });
}

function nextPaint(view: Window): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    view.setTimeout(finish, 120);
    view.requestAnimationFrame(() => {
      view.requestAnimationFrame(finish);
    });
  });
}

function restoreStyleProperty(
  element: HTMLElement,
  property: string,
  value: string,
  priority: string,
) {
  if (value) {
    element.style.setProperty(property, value, priority);
  } else {
    element.style.removeProperty(property);
  }
}
