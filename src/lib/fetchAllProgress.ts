/** Browser-persisted checkpoint for "Fetch all" Gmail status runs (resume after refresh). */

export type FetchAllProgressCheckpoint = {
  messageId: string;
  /** Last row index fully processed (0-based). Resume starts at this + 1. */
  lastCompletedIndex: number;
  total: number;
  updatedAt: string;
};

const STORAGE_PREFIX = "sentinel_fetch_all_progress_";

function storageKey(messageId: string): string {
  return `${STORAGE_PREFIX}${messageId}`;
}

export function getFetchAllProgress(messageId: string): FetchAllProgressCheckpoint | null {
  if (!messageId) return null;
  try {
    const raw = localStorage.getItem(storageKey(messageId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FetchAllProgressCheckpoint;
    if (parsed.messageId !== messageId) return null;
    if (!Number.isFinite(parsed.lastCompletedIndex) || !Number.isFinite(parsed.total)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setFetchAllProgress(
  messageId: string,
  lastCompletedIndex: number,
  total: number
): void {
  if (!messageId) return;
  try {
    const payload: FetchAllProgressCheckpoint = {
      messageId,
      lastCompletedIndex,
      total,
      updatedAt: new Date().ISOString(),
    };
    localStorage.setItem(storageKey(messageId), JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function clearFetchAllProgress(messageId: string): void {
  if (!messageId) return;
  try {
    localStorage.removeItem(storageKey(messageId));
  } catch {
    /* ignore */
  }
}

/** True when a prior run stopped before the last row and totals still match. */
export function canResumeFetchAll(
  messageId: string,
  currentTotal: number
): { canResume: boolean; resumeFromIndex: number; checkpoint: FetchAllProgressCheckpoint | null } {
  const cp = getFetchAllProgress(messageId);
  if (!cp || cp.total !== currentTotal) {
    if (cp && cp.total !== currentTotal) clearFetchAllProgress(messageId);
    return { canResume: false, resumeFromIndex: 0, checkpoint: null };
  }
  const next = cp.lastCompletedIndex + 1;
  if (next >= currentTotal) {
    clearFetchAllProgress(messageId);
    return { canResume: false, resumeFromIndex: 0, checkpoint: null };
  }
  return { canResume: true, resumeFromIndex: next, checkpoint: cp };
}
