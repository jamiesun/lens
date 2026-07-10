import { create } from 'zustand';
import type { SnapshotErrorCode } from '../protocol/messages';
import type { PageSnapshot } from '../protocol/page-snapshot';
import {
  requestPageSnapshot,
  SnapshotClientError,
} from './runtime-client';

export type ObserverPhase = 'idle' | 'scanning' | 'ready' | 'error';

export interface TraceEntry {
  id: string;
  tool: 'page.snapshot';
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  durationMs?: number;
  detail: string;
}

interface ObserverError {
  code: SnapshotErrorCode;
  title: string;
  message: string;
}

interface ObserverState {
  phase: ObserverPhase;
  snapshot?: PageSnapshot;
  error?: ObserverError;
  trace: TraceEntry[];
  scanPage: () => Promise<void>;
}

function createTraceId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `trace_${Date.now().toString(36)}`;
}

function formatError(error: unknown): ObserverError {
  if (!(error instanceof SnapshotClientError)) {
    return {
      code: 'SNAPSHOT_FAILED',
      title: 'Snapshot interrupted',
      message: error instanceof Error ? error.message : String(error),
    };
  }

  switch (error.code) {
    case 'PAGE_ACCESS_DENIED':
      return {
        code: error.code,
        title: 'Page access not armed',
        message:
          'Open Lens from the browser toolbar on this page, then scan again.',
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
    case 'INVALID_REQUEST':
    case 'INVALID_SNAPSHOT':
      return {
        code: error.code,
        title: 'Protocol mismatch',
        message:
          'The page observer and Side Panel returned incompatible data.',
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

  async scanPage() {
    if (get().phase === 'scanning') {
      return;
    }

    const traceId = createTraceId();
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
      error: undefined,
      trace: [traceEntry, ...state.trace].slice(0, 8),
    }));

    try {
      const snapshot = await requestPageSnapshot();
      const durationMs = Math.round(performance.now() - startedAt);

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

      set((state) => ({
        phase: 'error',
        error: observerError,
        trace: replaceTrace(state.trace, traceId, {
          status: 'failed',
          durationMs,
          detail: observerError.title,
        }),
      }));
    }
  },
}));
