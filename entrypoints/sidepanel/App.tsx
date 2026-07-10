import { useState } from 'react';
import type {
  ActionDescriptor,
  FormDescriptor,
  FormFieldDescriptor,
  PageSnapshot,
} from '../../src/protocol/page-snapshot';
import type {
  FieldFillOutcome,
  FillFieldValue,
} from '../../src/protocol/page-commands';
import {
  type ObserverPhase,
  type TraceEntry,
  useObserverStore,
} from '../../src/sidepanel/observer-store';

const phaseLabels: Record<ObserverPhase, string> = {
  idle: 'STANDBY',
  scanning: 'SCANNING',
  ready: 'LOCKED',
  error: 'INTERRUPTED',
};

const EDITABLE_FIELD_TYPES = new Set([
  'text',
  'email',
  'tel',
  'url',
  'search',
  'number',
  'textarea',
]);

function isEditableField(field: FormFieldDescriptor): boolean {
  return !field.sensitive && EDITABLE_FIELD_TYPES.has(field.fieldType);
}

function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
      <circle cx="12" cy="12" r="3.25" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h13M14 7l5 5-5 5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 5.5 5.8v5.7c0 4.4 2.7 7.6 6.5 9.5 3.8-1.9 6.5-5.1 6.5-9.5V5.8L12 3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function EmptyTarget() {
  return (
    <section className="empty-target" aria-labelledby="empty-title">
      <div className="target-mark" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <i />
      </div>
      <p className="section-index">00 / TARGET</p>
      <h2 id="empty-title">Arm the page lens.</h2>
      <p>
        从浏览器工具栏打开 Lens 后扫描当前页面。扫描只读取可见语义，
        填写字段会实时显示逐项结果。
      </p>
    </section>
  );
}

function Metric({
  value,
  label,
  testId,
}: {
  value: number;
  label: string;
  testId?: string;
}) {
  return (
    <div className="metric">
      <strong data-testid={testId}>{value.toString().padStart(2, '0')}</strong>
      <span>{label}</span>
    </div>
  );
}

function SnapshotHeader({ snapshot }: { snapshot: PageSnapshot }) {
  const targetUrl = new URL(snapshot.url);

  return (
    <section className="target-card" aria-labelledby="page-title">
      <div className="target-card__eyebrow">
        <span>CURRENT PAGE</span>
        <span>
          GEN {snapshot.generation.toString().padStart(2, '0')} ·{' '}
          {snapshot.pageType ?? 'UNDECLARED'}
        </span>
      </div>
      <h1 id="page-title" data-testid="page-title">
        {snapshot.title || targetUrl.hostname}
      </h1>
      <div className="route-line">
        <span>{targetUrl.hostname}</span>
        <span>{snapshot.route ?? targetUrl.pathname}</span>
      </div>
      {snapshot.visibleTextSummary ? (
        <p className="page-summary">{snapshot.visibleTextSummary}</p>
      ) : (
        <p className="page-summary page-summary--muted">
          No safe summary fragments were exposed by this page.
        </p>
      )}
    </section>
  );
}

function FillBadge({ outcome }: { outcome?: FieldFillOutcome }) {
  if (!outcome) {
    return null;
  }

  return (
    <span
      className={
        outcome.status === 'filled'
          ? 'fill-badge fill-badge--filled'
          : 'fill-badge fill-badge--rejected'
      }
      data-testid="fill-badge"
    >
      {outcome.status === 'filled' ? 'FILLED' : outcome.reason.toUpperCase()}
    </span>
  );
}

function FormEditor({
  form,
  outcomes,
  busy,
  onFill,
}: {
  form: FormDescriptor;
  outcomes: Record<string, FieldFillOutcome>;
  busy: boolean;
  onFill: (formNodeId: string, fields: FillFieldValue[]) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});

  const dirtyFields: FillFieldValue[] = Object.entries(draft)
    .filter(([, value]) => value.length > 0)
    .map(([nodeId, value]) => ({ nodeId, value }));

  return (
    <article className="form-row" key={form.nodeId}>
      <div className="form-row__title">
        <strong>{form.label ?? form.formId}</strong>
        <span>{form.validationState}</span>
      </div>

      <div className="fill-editor">
        {form.fields.map((field) => {
          if (isEditableField(field)) {
            return (
              <label className="fill-row" key={field.nodeId}>
                <span className="fill-row__label">
                  {field.label ?? field.name ?? field.fieldType}
                </span>
                <input
                  className="fill-row__input"
                  type="text"
                  value={draft[field.nodeId] ?? ''}
                  placeholder={field.hasValue ? '(keeps current value)' : '—'}
                  data-field-name={field.name ?? field.nodeId}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      [field.nodeId]: event.target.value,
                    }))
                  }
                />
                <FillBadge outcome={outcomes[field.nodeId]} />
              </label>
            );
          }

          return (
            <div className="fill-row fill-row--locked" key={field.nodeId}>
              <span className="fill-row__label">
                {field.label ?? field.name ?? field.fieldType}
              </span>
              <span
                className={
                  field.sensitive
                    ? 'field-tag is-sensitive'
                    : 'field-tag'
                }
              >
                {field.sensitive ? 'MASKED' : field.fieldType.toUpperCase()}
              </span>
            </div>
          );
        })}
      </div>

      <div className="fill-actions">
        <span className="fill-actions__note">
          local-write · auto-applied · no submit
        </span>
        <button
          className="apply-button"
          type="button"
          disabled={busy || dirtyFields.length === 0}
          data-testid={`apply-fill-${form.formId}`}
          onClick={() => onFill(form.nodeId, dirtyFields)}
        >
          <ArrowIcon />
          {busy ? 'APPLYING' : 'APPLY FILL'}
        </button>
      </div>
    </article>
  );
}

function FormInventory({
  forms,
  outcomes,
  fillingFormId,
  onFill,
}: {
  forms: FormDescriptor[];
  outcomes: Record<string, FieldFillOutcome>;
  fillingFormId?: string;
  onFill: (formNodeId: string, fields: FillFieldValue[]) => void;
}) {
  return (
    <section className="instrument-card" aria-labelledby="forms-title">
      <div className="instrument-card__header">
        <div>
          <p className="section-index">02 / FORMS</p>
          <h2 id="forms-title">Field inventory</h2>
        </div>
        <span className="count-chip">{forms.length}</span>
      </div>

      {forms.length === 0 ? (
        <p className="quiet-state">No visible form controls detected.</p>
      ) : (
        <div className="inventory-list">
          {forms.slice(0, 4).map((form) => (
            <FormEditor
              key={form.nodeId}
              form={form}
              outcomes={outcomes}
              busy={fillingFormId === form.nodeId}
              onFill={onFill}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ActionInventory({ actions }: { actions: ActionDescriptor[] }) {
  return (
    <section className="instrument-card" aria-labelledby="actions-title">
      <div className="instrument-card__header">
        <div>
          <p className="section-index">03 / ACTIONS</p>
          <h2 id="actions-title">Declared controls</h2>
        </div>
        <span className="count-chip">{actions.length}</span>
      </div>

      {actions.length === 0 ? (
        <p className="quiet-state">No visible actions detected.</p>
      ) : (
        <div className="action-list">
          {actions.slice(0, 6).map((action) => (
            <div className="action-row" key={action.nodeId}>
              <span className="action-row__mark" aria-hidden="true">
                <ArrowIcon />
              </span>
              <span className="action-row__label">{action.label}</span>
              <span
                className={`risk-label risk-label--${
                  action.declaredRisk ?? 'unrated'
                }`}
              >
                {action.declaredRisk ?? 'unrated'}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="trust-note">
        Page-declared risk is descriptive only. Runtime policy remains authoritative.
      </p>
    </section>
  );
}

function TracePanel({ trace }: { trace: TraceEntry[] }) {
  return (
    <section className="trace-card" aria-labelledby="trace-title">
      <div className="instrument-card__header">
        <div>
          <p className="section-index">04 / TRACE</p>
          <h2 id="trace-title">Local execution</h2>
        </div>
        <span className="live-dot">LOCAL</span>
      </div>

      {trace.length === 0 ? (
        <p className="quiet-state">No tool calls in this session.</p>
      ) : (
        <ol className="trace-list">
          {trace.map((entry) => (
            <li key={entry.id}>
              <span className={`trace-state trace-state--${entry.status}`} />
              <div>
                <strong>{entry.tool}</strong>
                <span>{entry.detail}</span>
              </div>
              <time>
                {entry.status === 'running'
                  ? '…'
                  : `${entry.durationMs ?? 0} ms`}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default function App() {
  const phase = useObserverStore((state) => state.phase);
  const snapshot = useObserverStore((state) => state.snapshot);
  const error = useObserverStore((state) => state.error);
  const trace = useObserverStore((state) => state.trace);
  const fillingFormId = useObserverStore((state) => state.fillingFormId);
  const fillOutcomes = useObserverStore((state) => state.fillOutcomes);
  const localWriteCount = useObserverStore((state) => state.localWriteCount);
  const scanPage = useObserverStore((state) => state.scanPage);
  const fillForm = useObserverStore((state) => state.fillForm);

  const fieldCount =
    snapshot?.forms.reduce((total, form) => total + form.fields.length, 0) ?? 0;

  return (
    <div className={`app-shell app-shell--${phase}`}>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">L</span>
          <span>
            <strong>LENS</strong>
            <small>PAGE OBSERVER / M1</small>
          </span>
        </div>
        <div
          className="runtime-status"
          data-phase={phase}
          data-testid="scan-status"
          aria-live="polite"
        >
          <span />
          {phaseLabels[phase]}
        </div>
      </header>

      <main>
        <section className="command-rail">
          <div>
            <p className="section-index">01 / OBSERVE</p>
            <p className="command-copy">
              Read the active page, then fill visible fields with per-field
              receipts.
            </p>
          </div>
          <button
            className="scan-button"
            type="button"
            onClick={() => void scanPage()}
            disabled={phase === 'scanning' || Boolean(fillingFormId)}
            data-testid="scan-page"
          >
            <ScanIcon />
            <span>{snapshot ? 'RESCAN' : 'SCAN PAGE'}</span>
          </button>
        </section>

        {error ? (
          <aside
            className="error-panel"
            data-testid="error-banner"
            data-error-code={error.code}
            role="alert"
          >
            <span className="error-panel__code">{error.code}</span>
            <div>
              <strong>{error.title}</strong>
              <p>{error.message}</p>
            </div>
          </aside>
        ) : null}

        {snapshot ? (
          <div className="snapshot-stack">
            <SnapshotHeader snapshot={snapshot} />

            <section className="metrics-grid" aria-label="Page inventory">
              <Metric
                value={snapshot.forms.length}
                label="FORMS"
                testId="form-count"
              />
              <Metric value={fieldCount} label="FIELDS" />
              <Metric value={snapshot.actions.length} label="ACTIONS" />
              <Metric value={snapshot.tables.length} label="TABLES" />
              <Metric value={snapshot.alerts.length} label="ALERTS" />
            </section>

            <div className="instrument-grid">
              <FormInventory
                forms={snapshot.forms}
                outcomes={fillOutcomes}
                fillingFormId={fillingFormId}
                onFill={(formNodeId, fields) => void fillForm(formNodeId, fields)}
              />
              <ActionInventory actions={snapshot.actions} />
            </div>
          </div>
        ) : (
          <EmptyTarget />
        )}

        <section
          className="write-gate"
          aria-label="Write gate status"
          data-testid="write-gate"
        >
          <span className="write-gate__icon">
            <ShieldIcon />
          </span>
          <div>
            <strong>
              WRITE GATE · {localWriteCount} LOCAL · 0 PENDING
            </strong>
            <p>Fills apply locally with receipts. Submits stay locked.</p>
          </div>
          <span className="write-gate__status">SAFE</span>
        </section>

        <TracePanel trace={trace} />
      </main>

      <footer>
        <span>LOCAL RUNTIME</span>
        <span>NO SERVER</span>
        <span>v0.1.0</span>
      </footer>
    </div>
  );
}
