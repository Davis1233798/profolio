export type SnapshotValue = { success: boolean; data: Record<string, number>; error?: { message: string } };
type Timer = number;
export type SnapshotPollingRuntime = {
  fetch: typeof fetch;
  isHidden(): boolean;
  onVisibilityChange(listener: () => void): () => void;
  schedule(callback: () => void, delay: number): Timer;
  cancel(timer: Timer): void;
};

const browserRuntime: SnapshotPollingRuntime = {
  fetch: (...args) => fetch(...args),
  isHidden: () => document.hidden,
  onVisibilityChange(listener) {
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
  schedule: (callback, delay) => window.setTimeout(callback, delay),
  cancel: timer => window.clearTimeout(timer),
};

/** Poll once at a time, pausing and aborting work while the document is hidden. */
export function startSnapshotPolling(
  site: string,
  onValue: (data: Record<string, number>) => void,
  onError: (message: string) => void,
  runtime: SnapshotPollingRuntime = browserRuntime,
): () => void {
  let active = true;
  let pollTimer: Timer | null = null;
  let deadlineTimer: Timer | null = null;
  let request: AbortController | null = null;
  const clearPollTimer = () => {
    if (pollTimer !== null) { runtime.cancel(pollTimer); pollTimer = null; }
  };

  async function refresh() {
    if (!active || runtime.isHidden() || request) return;
    const current = new AbortController();
    request = current;
    deadlineTimer = runtime.schedule(() => current.abort(), 15_000);
    try {
      const response = await runtime.fetch(`/api/stations/${site}/operations-snapshot`, {
        credentials: 'same-origin', cache: 'no-store', signal: current.signal,
      });
      const value = await response.json() as SnapshotValue;
      if (!response.ok || !value.success) throw new Error(value.error?.message || `HTTP ${response.status}`);
      if (active && request === current && !current.signal.aborted) onValue(value.data);
    } catch (error) {
      if (active && request === current && !current.signal.aborted) onError((error as Error).message);
    } finally {
      if (request === current) {
        if (deadlineTimer !== null) runtime.cancel(deadlineTimer);
        deadlineTimer = null;
        request = null;
        if (active && !runtime.isHidden()) pollTimer = runtime.schedule(() => { pollTimer = null; void refresh(); }, 10_000);
      }
    }
  }

  const unsubscribe = runtime.onVisibilityChange(() => {
    if (runtime.isHidden()) {
      clearPollTimer();
      if (request) {
        request.abort();
        if (deadlineTimer !== null) runtime.cancel(deadlineTimer);
        deadlineTimer = null;
        request = null;
      }
    } else {
      clearPollTimer();
      void refresh();
    }
  });
  void refresh();

  return () => {
    active = false;
    clearPollTimer();
    if (deadlineTimer !== null) runtime.cancel(deadlineTimer);
    request?.abort();
    request = null;
    unsubscribe();
  };
}
