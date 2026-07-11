import type {
  ActionDescriptor,
  AlertDescriptor,
  FormDescriptor,
  FormFieldDescriptor,
  PageSnapshot,
  SemanticNode,
  TableDescriptor,
  ToolRisk,
} from '../protocol/page-snapshot';
import { ElementRegistry } from './element-registry';

const MAX_TEXT_LENGTH = 240;
const MAX_SUMMARY_LENGTH = 1_600;
const SENSITIVE_FIELD_PATTERN =
  /(pass(word)?|secret|token|api[-_ ]?key|credential|one[-_ ]?time|\botp\b)/i;
const KNOWN_RISKS = new Set<ToolRisk>([
  'observe',
  'local-write',
  'server-write',
  'destructive',
  'financial',
]);

function normalizeText(
  value: string | null | undefined,
  maxLength = MAX_TEXT_LENGTH,
): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.slice(0, maxLength);
}

function isVisible(element: Element, view: Window): boolean {
  if (
    element.closest('[hidden], [aria-hidden="true"], [inert]') ||
    (element instanceof HTMLInputElement && element.type === 'hidden')
  ) {
    return false;
  }

  const style = view.getComputedStyle(element);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse' ||
    style.opacity === '0'
  ) {
    return false;
  }

  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}

function readLabel(element: HTMLElement): string | undefined {
  return readAttributeLabel(element) ?? readFallbackLabel(element);
}

function readAttributeLabel(element: HTMLElement): string | undefined {
  const directLabel =
    element.dataset.agentLabel ??
    element.getAttribute('aria-label') ??
    element.getAttribute('title');
  if (normalizeText(directLabel)) {
    return normalizeText(directLabel);
  }

  const labelledBy = element
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent)
    .filter((value): value is string => Boolean(value))
    .join(' ');
  if (normalizeText(labelledBy)) {
    return normalizeText(labelledBy);
  }

  if ('labels' in element) {
    const labels = (element as HTMLInputElement).labels;
    const labelText = labels ? Array.from(labels, (label) => label.textContent).join(' ') : '';
    if (normalizeText(labelText)) {
      return normalizeText(labelText);
    }
  }

  const wrappingLabel = element.closest('label');
  if (normalizeText(wrappingLabel?.textContent)) {
    return normalizeText(wrappingLabel?.textContent);
  }

  return undefined;
}

function readFallbackLabel(element: HTMLElement): string | undefined {
  return normalizeText(
    element.getAttribute('placeholder') ??
      element.getAttribute('name') ??
      element.id,
  );
}

// Activation targets read better by their visible text than by id/name
// fallbacks, so the model can match goals like "点击 重新开始".
function readActionLabel(element: HTMLElement): string | undefined {
  return (
    readAttributeLabel(element) ??
    normalizeText(element.textContent) ??
    readFallbackLabel(element)
  );
}

function readRole(element: HTMLElement): string {
  const explicitRole = normalizeText(element.getAttribute('role'), 64);
  if (explicitRole) {
    return explicitRole;
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName === 'button') {
    return 'button';
  }
  if (tagName === 'a') {
    return 'link';
  }
  if (tagName === 'textarea') {
    return 'textbox';
  }
  if (tagName === 'select') {
    return 'combobox';
  }
  if (tagName === 'input') {
    const inputType = (element as HTMLInputElement).type;
    if (inputType === 'checkbox' || inputType === 'radio') {
      return inputType;
    }
    if (inputType === 'submit' || inputType === 'button') {
      return 'button';
    }
    return 'textbox';
  }
  if (/^h[1-6]$/.test(tagName)) {
    return 'heading';
  }

  return tagName;
}

function readHeadingLevel(element: HTMLElement): number | undefined {
  const ariaLevel = Number.parseInt(element.getAttribute('aria-level') ?? '', 10);
  if (ariaLevel >= 1 && ariaLevel <= 6) {
    return ariaLevel;
  }

  const match = /^h([1-6])$/.exec(element.tagName.toLowerCase());
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

function isSensitiveField(element: HTMLElement, label?: string): boolean {
  if (element.dataset.agentSensitive === 'true') {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    if (element.type === 'password') {
      return true;
    }

    if (
      ['current-password', 'new-password', 'one-time-code'].includes(
        element.autocomplete,
      )
    ) {
      return true;
    }
  }

  return SENSITIVE_FIELD_PATTERN.test(
    [
      label,
      element.getAttribute('name'),
      element.id,
      element.getAttribute('autocomplete'),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function readFieldType(element: HTMLElement): string {
  if (element instanceof HTMLInputElement) {
    return element.type || 'text';
  }
  if (element instanceof HTMLSelectElement) {
    return element.multiple ? 'select-multiple' : 'select-one';
  }
  if (element instanceof HTMLTextAreaElement) {
    return 'textarea';
  }
  return element.isContentEditable ? 'contenteditable' : element.tagName.toLowerCase();
}

function readValuePresence(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox' || element.type === 'radio') {
      return element.checked;
    }
    return element.value.length > 0;
  }
  if (element instanceof HTMLSelectElement) {
    return element.selectedIndex >= 0 && element.value.length > 0;
  }
  if (element instanceof HTMLTextAreaElement) {
    return element.value.length > 0;
  }
  return Boolean(normalizeText(element.textContent));
}

function toSemanticNode(
  element: HTMLElement,
  registry: ElementRegistry,
): SemanticNode {
  const text = normalizeText(element.textContent);
  const level = readHeadingLevel(element);

  return {
    nodeId: registry.register(element),
    role: readRole(element),
    label: readLabel(element),
    text,
    level,
    disabled:
      'disabled' in element
        ? Boolean((element as HTMLButtonElement).disabled)
        : undefined,
    required:
      'required' in element
        ? Boolean((element as HTMLInputElement).required)
        : undefined,
    visible: true,
  };
}

function collectHeadings(
  document: Document,
  view: Window,
  registry: ElementRegistry,
): SemanticNode[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      'h1, h2, h3, h4, h5, h6, [role="heading"]',
    ),
  )
    .filter((element) => isVisible(element, view))
    .slice(0, 30)
    .map((element) => toSemanticNode(element, registry));
}

function collectFields(
  root: ParentNode,
  view: Window,
  registry: ElementRegistry,
): FormFieldDescriptor[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, [contenteditable="true"]',
    ),
  )
    .filter((element) => isVisible(element, view))
    .slice(0, 80)
    .map((element) => {
      const label = readLabel(element);
      const sensitive = isSensitiveField(element, label);
      const semanticNode = toSemanticNode(element, registry);

      return {
        ...semanticNode,
        label,
        name: normalizeText(element.getAttribute('name'), 120),
        fieldType: readFieldType(element),
        autocomplete: normalizeText(element.getAttribute('autocomplete'), 120),
        sensitive,
        ...(sensitive ? {} : { hasValue: readValuePresence(element) }),
      };
    });
}

function readValidationState(
  form: HTMLFormElement,
): FormDescriptor['validationState'] {
  return form.matches(':invalid') ? 'invalid' : 'valid';
}

function collectForms(
  document: Document,
  view: Window,
  registry: ElementRegistry,
): FormDescriptor[] {
  const forms = Array.from(
    document.querySelectorAll<HTMLFormElement>('form, [data-agent-form]'),
  )
    .filter((element) => isVisible(element, view))
    .slice(0, 19)
    .map((form) => {
      const nodeId = registry.register(form);
      const submitActions = Array.from(
        form.querySelectorAll<HTMLElement>(
          'button:not([type]), button[type="submit"], input[type="submit"], [data-agent-action]',
        ),
      )
        .filter((element) => isVisible(element, view))
        .slice(0, 20)
        .map((element) => registry.register(element));

      return {
        nodeId,
        formId:
          normalizeText(
            form.dataset.agentForm ?? form.id ?? form.getAttribute('name'),
            120,
          ) ?? nodeId,
        label: readLabel(form),
        fields: collectFields(form, view, registry),
        submitActions,
        validationState:
          form instanceof HTMLFormElement
            ? readValidationState(form)
            : 'unknown',
      } satisfies FormDescriptor;
    });

  const unownedFields = collectFields(document, view, registry).filter(
    (field) => {
      const element = registry.resolve(field.nodeId);
      return element instanceof HTMLElement && !element.closest('form, [data-agent-form]');
    },
  );

  if (unownedFields.length > 0 && forms.length < 20) {
    forms.push({
      nodeId: registry.register(document.body),
      formId: 'implicit-page-fields',
      label: 'Page fields',
      fields: unownedFields,
      submitActions: [],
      validationState: 'unknown',
    });
  }

  return forms;
}

function parseDeclaredRisk(value: string | undefined): ToolRisk | undefined {
  return value && KNOWN_RISKS.has(value as ToolRisk)
    ? (value as ToolRisk)
    : undefined;
}

const EXPLICIT_ACTION_SELECTOR =
  'button, [role="button"], input[type="submit"], input[type="button"], a[href], [data-agent-action]';
const CLICKABLE_SELF_SKIP =
  'html, body, input, select, textarea, option, optgroup, label, form';
const MAX_ACTIONS = 50;
const MAX_CLICKABLES = 20;
const MAX_CLICKABLE_SCAN = 1_500;

function describeClickTarget(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const classes = Array.from(element.classList)
    .slice(0, 3)
    .map((name) => `.${name}`)
    .join('');
  const dataAttributes = Array.from(element.attributes)
    .filter(
      (attribute) =>
        attribute.name.startsWith('data-') &&
        !attribute.name.startsWith('data-agent-'),
    )
    .slice(0, 2)
    .map((attribute) => `[${attribute.name}="${attribute.value.slice(0, 24)}"]`)
    .join('');

  return `${tag}${id}${classes}${dataAttributes}`;
}

/**
 * Collects elements that advertise a click affordance (pointer cursor or an
 * inline onclick attribute) without carrying button/link semantics, so pages
 * built from styled divs — game boards, custom widgets — stay operable.
 * Only the outermost pointer target of a subtree is kept.
 */
function collectClickables(
  document: Document,
  view: Window,
  registry: ElementRegistry,
  budget: number,
): ActionDescriptor[] {
  const clickables: ActionDescriptor[] = [];
  const body = document.body;
  if (!body || budget <= 0) {
    return clickables;
  }

  let examined = 0;
  for (const element of Array.from(body.getElementsByTagName('*'))) {
    if (
      examined >= MAX_CLICKABLE_SCAN ||
      clickables.length >= Math.min(budget, MAX_CLICKABLES)
    ) {
      break;
    }
    examined += 1;

    if (!(element instanceof HTMLElement)) {
      continue;
    }
    if (
      element.matches(CLICKABLE_SELF_SKIP) ||
      element.closest(`${EXPLICIT_ACTION_SELECTOR}, label`) ||
      element.querySelector(EXPLICIT_ACTION_SELECTOR)
    ) {
      continue;
    }

    const hasOnclick = element.hasAttribute('onclick');
    const pointer = view.getComputedStyle(element).cursor === 'pointer';
    if (!hasOnclick && !pointer) {
      continue;
    }
    if (!hasOnclick && pointer) {
      const parent = element.parentElement;
      if (
        parent &&
        parent !== body &&
        view.getComputedStyle(parent).cursor === 'pointer'
      ) {
        continue;
      }
    }
    if (!isVisible(element, view)) {
      continue;
    }

    const descriptor = describeClickTarget(element);
    const text = normalizeText(element.textContent, 60);
    const label =
      readAttributeLabel(element) ??
      normalizeText(text ? `${descriptor} · ${text}` : descriptor, 160);
    if (!label) {
      continue;
    }

    clickables.push({
      nodeId: registry.register(element),
      role: 'clickable',
      label,
      disabled: false,
    });
  }

  return clickables;
}

function collectActions(
  document: Document,
  view: Window,
  registry: ElementRegistry,
): ActionDescriptor[] {
  const actions: ActionDescriptor[] = [];
  const elements = Array.from(
    document.querySelectorAll<HTMLElement>(EXPLICIT_ACTION_SELECTOR),
  ).filter((element) => isVisible(element, view));

  for (const element of elements) {
    const label = readActionLabel(element);
    if (!label) {
      continue;
    }

    const declaredAction = normalizeText(element.dataset.agentAction, 160);
    const declaredRisk = parseDeclaredRisk(element.dataset.agentRisk);

    actions.push({
      nodeId: registry.register(element),
      role: readRole(element),
      label,
      ...(declaredAction ? { declaredAction } : {}),
      ...(declaredRisk ? { declaredRisk } : {}),
      disabled:
        'disabled' in element
          ? Boolean((element as HTMLButtonElement).disabled)
          : false,
    });

    if (actions.length >= MAX_ACTIONS) {
      break;
    }
  }

  actions.push(
    ...collectClickables(document, view, registry, MAX_ACTIONS - actions.length),
  );

  return actions;
}

function collectTables(
  document: Document,
  view: Window,
  registry: ElementRegistry,
): TableDescriptor[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('table, [role="table"]'),
  )
    .filter((element) => isVisible(element, view))
    .slice(0, 10)
    .map((table) => {
      const rows = Array.from(table.querySelectorAll('tr, [role="row"]'));
      const headers = Array.from(
        table.querySelectorAll<HTMLElement>('th, [role="columnheader"]'),
      )
        .map((header) => normalizeText(header.textContent, 120))
        .filter((header): header is string => Boolean(header))
        .slice(0, 30);
      const columnCount = rows.reduce(
        (maximum, row) =>
          Math.max(
            maximum,
            row.querySelectorAll('th, td, [role="cell"], [role="columnheader"]')
              .length,
          ),
        0,
      );

      return {
        nodeId: registry.register(table),
        label:
          readLabel(table) ??
          normalizeText(table.querySelector('caption')?.textContent),
        headers,
        rowCount: rows.length,
        columnCount,
      };
    });
}

function collectAlerts(
  document: Document,
  view: Window,
  registry: ElementRegistry,
): AlertDescriptor[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="alert"], [role="status"], [aria-live]',
    ),
  )
    .filter((element) => isVisible(element, view))
    .map((element) => {
      const text = normalizeText(element.textContent);
      if (!text) {
        return undefined;
      }

      const role =
        element.getAttribute('role') === 'alert'
          ? 'alert'
          : element.getAttribute('role') === 'status'
            ? 'status'
            : 'live-region';

      return {
        nodeId: registry.register(element),
        role,
        text,
      } satisfies AlertDescriptor;
    })
    .filter((alert): alert is AlertDescriptor => Boolean(alert))
    .slice(0, 20);
}

function collectVisibleTextSummary(
  document: Document,
  view: Window,
): string | undefined {
  const fragments = new Set<string>();
  let totalLength = 0;

  for (const element of document.querySelectorAll<HTMLElement>(
    '[data-agent-summary], main p, main li, article p, article li, body > p',
  )) {
    if (
      !isVisible(element, view) ||
      element.closest('form, [data-agent-sensitive="true"], [role="alert"]')
    ) {
      continue;
    }

    const text = normalizeText(element.textContent, 320);
    if (!text || fragments.has(text)) {
      continue;
    }

    fragments.add(text);
    totalLength += text.length;
    if (fragments.size >= 12 || totalLength >= MAX_SUMMARY_LENGTH) {
      break;
    }
  }

  return normalizeText(
    Array.from(fragments).join(' · '),
    MAX_SUMMARY_LENGTH,
  );
}

export function buildPageSnapshot(
  document: Document,
  view: Window,
  registry: ElementRegistry,
): PageSnapshot {
  const pageType = normalizeText(
    document.documentElement.dataset.agentPageType ??
      document
        .querySelector<HTMLMetaElement>('meta[name="frontend-agent:page-type"]')
        ?.content,
    160,
  );
  const selectedText = normalizeText(view.getSelection()?.toString(), 500);
  const visibleTextSummary = collectVisibleTextSummary(document, view);
  const route = normalizeText(
    `${view.location.pathname}${view.location.search}${view.location.hash}`,
    500,
  );
  const language = normalizeText(document.documentElement.lang, 32);

  return {
    version: 1,
    snapshotId: registry.snapshotId,
    generation: registry.generation,
    capturedAt: new Date().toISOString(),
    url: view.location.href,
    title: normalizeText(document.title, 180) ?? '',
    route,
    pageType,
    language,
    headings: collectHeadings(document, view, registry),
    forms: collectForms(document, view, registry),
    tables: collectTables(document, view, registry),
    actions: collectActions(document, view, registry),
    alerts: collectAlerts(document, view, registry),
    selectedText,
    visibleTextSummary,
  };
}

export function isElementVisible(element: Element, view: Window): boolean {
  return isVisible(element, view);
}

export function isFieldSensitive(element: HTMLElement): boolean {
  return isSensitiveField(element, readLabel(element));
}
