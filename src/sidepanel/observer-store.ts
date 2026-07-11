import { create } from 'zustand';
import type { RuntimeErrorCode } from '../protocol/messages';
import type {
  FieldFillOutcome,
  FillFieldValue,
} from '../protocol/page-commands';
import type { PageSnapshot } from '../protocol/page-snapshot';
import {
  LensRuntimeError,
  requestFormFill,
  requestPageSnapshot,
} from './runtime-client';

export type ObserverPhase = 'idle' | 'scanning' | 'ready' | 'error';

export interface TraceEntry {
  id: string;
  tool: 'page.snapshot' | 'page.form.fill';
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  durationMs?: number;
  detail: string;
}

interface ObserverError {
  code: RuntimeErrorCode;
  title: string;
  message: string;
}

interface ObserverState {
  phase: ObserverPhase;
  snapshot?: PageSnapshot;
  error?: ObserverError;
  trace: TraceEntry[];
  fillingFormId?: string;
  fillOutcomes: Record<string, FieldFillOutcome>;
  localWriteCount: number;
  pageRevision: number;
  scanPage: () => Promise<void>;
  fillForm: (formNodeId: string, fields: FillFieldValue[]) => Promise<void>;
  invalidatePage: () => void;
}

function createTraceId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `trace_${Date.now().toString(36)}`;
}

function formatError(error: unknown): ObserverError {
  if (!(error instanceof LensRuntimeError)) {
    return {
      code: 'SNAPSHOT_FAILED',
      title: 'Runtime interrupted',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  switch (error.code) {
    case 'PAGE_ACCESS_DENIED':
      return {
        code: error.code,
        title: '页面访问未激活',
        message:
          '点击浏览器工具栏中的 Lens 图标以授权当前页面；之后可在「页面信息」里开启长期授权，避免每次重复。',
      };
    case 'UNSUPPORTED_PAGE':
      return {
        code: error.code,
        title: 'Protected browser surface',
        message: 'Lens only observes regular HTTP and HTTPS pages.',
      };
    case 'NO_ACTIVE_TAB':
      return {
        code: error.code,
        title: 'No active target',
        message: 'Select a browser tab before starting a page scan.',
      };
    case 'STALE_SNAPSHOT':
      return {
        code: error.code,
        title: 'Snapshot out of date',
        message:
          'The page changed since the last scan. Rescan to refresh node identities.',
      };
    case 'INVALID_REQUEST':
    case 'INVALID_SNAPSHOT':
      return {
        code: error.code,
        title: 'Protocol mismatch',
        message:
          'The page observer and Side Panel returned incompatible data.',
      };
    case 'FILL_FAILED':
      return {
        code: error.code,
        title: 'Fill interrupted',
        message: error.message,
      };
    case 'CLICK_FAILED':
      return {
        code: error.code,
        title: 'Click interrupted',
        message: error.message,
      };
    case 'SNAPSHOT_FAILED':
      return {
        code: error.code,
        title: 'Snapshot interrupted',
        message: error.message,
      };
  }
}

function replaceTrace(
  trace: TraceEntry[],
  id: string,
  update: Partial<TraceEntry>,
): TraceEntry[] {
  return trace.map((entry) =>
    entry.id === id ? { ...entry, ...update } : entry,
  );
}

export const useObserverStore = create<ObserverState>((set, get) => ({
  phase: 'idle',
  trace: [],
  fillOutcomes: {},
  localWriteCount: 0,
  pageRevision: 0,

  async scanPage() {
    if (get().phase === 'scanning' || get().fillingFormId) {
      return;
    }

    const traceId = createTraceId();
    const pageRevision = get().pageRevision;
    const startedAt = performance.now();
    const traceEntry: TraceEntry = {
      id: traceId,
      tool: 'page.snapshot',
      status: 'running',
      startedAt: new Date().toISOString(),
      detail: 'Collecting visible semantic structure',
    };

    set((state) => ({
      phase: 'scanning',
      snapshot: undefined,
      error: undefined,
      fillOutcomes: {},
      trace: [traceEntry, ...state.trace].slice(0, 8),
    }));

    try {
      const snapshot = await requestPageSnapshot();
      const durationMs = Math.round(performance.now() - startedAt);
      if (get().pageRevision !== pageRevision) {
        return;
      }

      set((state) => ({
        phase: 'ready',
        snapshot,
        error: undefined,
        trace: replaceTrace(state.trace, traceId, {
          status: 'completed',
          durationMs,
          detail: `${snapshot.forms.length} forms · ${snapshot.actions.length} actions`,
        }),
      }));
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const observerError = formatError(error);
      if (get().pageRevision !== pageRevision) {
        return;
      }

      set((state) => ({
        phase: 'error',
        snapshot: undefined,
        error: observerError,
        trace: replaceTrace(state.trace, traceId, {
          status: 'failed',
          durationMs,
          detail: observerError.title,
        }),
      }));
    }
  },

  async fillForm(formNodeId, fields) {
    const { snapshot, phase, fillingFormId } = get();
    if (!snapshot || phase !== 'ready' || fillingFormId) {
      return;
    }

    const traceId = createTraceId();
    const pageRevision = get().pageRevision;
    const startedAt = performance.now();
    const traceEntry: TraceEntry = {
      id: traceId,
      tool: 'page.form.fill',
      status: 'running',
      startedAt: new Date().toISOString(),
      detail: `Writing ${fields.length} field${fields.length === 1 ? '' : 's'}`,
    };

    set((state) => ({
      fillingFormId: formNodeId,
      error: undefined,
      trace: [traceEntry, ...state.trace].slice(0, 8),
    }));

    try {
      const result = await requestFormFill({
        snapshotId: snapshot.snapshotId,
        generation: snapshot.generation,
        fields,
      });
      const durationMs = Math.round(performance.now() - startedAt);
      const filledCount = result.outcomes.filter(
        (outcome) => outcome.status === 'filled',
      ).length;

      if (get().pageRevision !== pageRevision) {
        set((state) => ({
          localWriteCount: state.localWriteCount + filledCount,
          trace: replaceTrace(state.trace, traceId, {
            status: 'completed',
            durationMs,
            detail: `${filledCount}/${result.outcomes.length} fields filled on previous page`,
          }),
        }));
        return;
      }

      set((state) => ({
        fillingFormId: undefined,
        fillOutcomes: {
          ...state.fillOutcomes,
          ...Object.fromEntries(
            result.outcomes.map((outcome) => [outcome.nodeId, outcome]),
          ),
        },
        localWriteCount: state.localWriteCount + filledCount,
        trace: replaceTrace(state.trace, traceId, {
          status: 'completed',
          durationMs,
          detail: `${filledCount}/${result.outcomes.length} fields filled`,
        }),
      }));
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      const observerError = formatError(error);
      if (get().pageRevision !== pageRevision) {
        set((state) => ({
          trace: replaceTrace(state.trace, traceId, {
            status: 'failed',
            durationMs,
            detail: `${observerError.title} on previous page`,
          }),
        }));
        return;
      }

      set((state) => ({
        fillingFormId: undefined,
        snapshot:
          observerError.code === 'STALE_SNAPSHOT'
            ? undefined
            : state.snapshot,
        error: observerError,
        trace: replaceTrace(state.trace, traceId, {
          status: 'failed',
          durationMs,
          detail: observerError.title,
        }),
      }));
    }
  },

  invalidatePage() {
    set((state) => ({
      pageRevision: state.pageRevision + 1,
      phase: 'idle',
      snapshot: undefined,
      error: undefined,
      fillingFormId: undefined,
      fillOutcomes: {},
    }));
  },
}));
