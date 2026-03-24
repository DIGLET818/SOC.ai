/**
 * Hook to load Gmail messages (e.g. from nttin.support@global.ntt, last 24h).
 * Optional storageKey: persist emails in sessionStorage, or when persistInLocalStorage:
 *   IndexedDB (large quota — much more than localStorage ~5MB) + legacy localStorage migration.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { getGmailMessages } from "@/api/gmail";
import type { GmailMessage } from "@/types/gmail";
import { idbDeleteMonthEmails, idbGetMonthEmails, idbPutMonthEmails } from "@/lib/emailCacheDb";

const DEFAULT_STORAGE: GmailMessage[] = [];

function getStorage(key: string, useLocal: boolean): Storage {
  return useLocal ? localStorage : sessionStorage;
}

/** Bodies/HTML are huge; Daily Alerts / Jira only need CSV + headers after reload. */
function stripHeavyFieldsForStorage(e: GmailMessage): GmailMessage {
  return {
    ...e,
    body: "",
    bodyHtml: undefined,
  };
}

function isQuotaError(e: unknown): boolean {
  if (e instanceof DOMException) {
    return (
      e.name === "QuotaExceededError" ||
      e.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      (typeof e.code === "number" && e.code === 22)
    );
  }
  if (e instanceof Error && /quota|exceeded|storage is full/i.test(e.message)) return true;
  return false;
}

/** Legacy single-blob month cache in localStorage (small quota). */
function loadLegacyLocalStorageSync(key: string): GmailMessage[] {
  try {
    const s = localStorage.getItem(key);
    if (s) return JSON.parse(s) as GmailMessage[];
  } catch {
    /* ignore */
  }
  return DEFAULT_STORAGE;
}

/**
 * sessionStorage: still ~5MB; strip bodies and trim if needed.
 * localStorage path uses IndexedDB instead (see persistMessages).
 */
function persistMessages(storageKey: string, useLocal: boolean, messages: GmailMessage[]): GmailMessage[] {
  if (useLocal) {
    const stripped = messages.map(stripHeavyFieldsForStorage);
    void idbPutMonthEmails(storageKey, stripped).catch((e) => {
      console.warn("useGmailMessages: IndexedDB cache write failed:", e);
    });
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    return messages;
  }

  const storage = getStorage(storageKey, useLocal);
  const stripped = messages.map(stripHeavyFieldsForStorage);

  const tryWrite = (arr: GmailMessage[]) => {
    storage.setItem(storageKey, JSON.stringify(arr));
  };

  try {
    tryWrite(stripped);
    return messages;
  } catch (e) {
    if (!isQuotaError(e)) {
      console.warn("useGmailMessages: sessionStorage setItem failed:", e);
      return messages;
    }
  }

  for (let k = stripped.length - 1; k >= 1; k--) {
    const tailStripped = stripped.slice(-k);
    try {
      tryWrite(tailStripped);
      console.warn(
        `useGmailMessages: sessionStorage quota exceeded; cached only the newest ${k} of ${stripped.length} report(s).`
      );
      return messages.slice(-k);
    } catch {
      /* try smaller k */
    }
  }

  try {
    storage.removeItem(storageKey);
  } catch {
    /* ignore */
  }
  console.warn("useGmailMessages: could not persist to sessionStorage.");
  return messages;
}

function loadFromSessionStorage(key: string): GmailMessage[] {
  try {
    const storage = getStorage(key, false);
    const s = storage.getItem(key);
    if (s) return JSON.parse(s) as GmailMessage[];
  } catch {
    /* ignore */
  }
  return DEFAULT_STORAGE;
}

export interface UseGmailMessagesParams {
  from: string;
  subject?: string;
  newerThanDays?: number;
  /** When both set, fetch emails in this date range (YYYY-MM-DD). Overrides newerThanDays. */
  afterDate?: string;
  beforeDate?: string;
  maxResults?: number;
  enabled?: boolean;
  includeCsv?: boolean;
  storageKey?: string;
  /** When true and storageKey is set, use IndexedDB (+ migrate legacy localStorage) so data survives refresh with a large cache. */
  persistInLocalStorage?: boolean;
}

export interface UseGmailMessagesResult {
  emails: GmailMessage[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Fetch a date range and merge into existing emails (by id). Use for fetching a single day without re-fetching the whole month. */
  refetchDateRange: (afterDate: string, beforeDate: string) => Promise<void>;
}

export function useGmailMessages({
  from,
  subject,
  newerThanDays = 1,
  afterDate,
  beforeDate,
  maxResults = 50,
  enabled = true,
  includeCsv,
  storageKey,
  persistInLocalStorage = false,
}: UseGmailMessagesParams): UseGmailMessagesResult {
  const useLocal = Boolean(storageKey && persistInLocalStorage);
  const [emails, setEmails] = useState<GmailMessage[]>(() => {
    if (!storageKey) return DEFAULT_STORAGE;
    if (useLocal) return loadLegacyLocalStorageSync(storageKey);
    return loadFromSessionStorage(storageKey);
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const prevStorageKey = useRef(storageKey);
  useEffect(() => {
    if (!storageKey || !useLocal) return;
    if (prevStorageKey.current !== storageKey) {
      prevStorageKey.current = storageKey;
      setEmails(loadLegacyLocalStorageSync(storageKey));
    }
  }, [storageKey, useLocal]);

  useEffect(() => {
    if (!storageKey || !useLocal) return;
    let cancelled = false;
    (async () => {
      const fromIdb = await idbGetMonthEmails(storageKey);
      if (cancelled) return;
      if (fromIdb && fromIdb.length > 0) {
        setEmails(fromIdb);
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* ignore */
        }
        return;
      }
      const legacy = loadLegacyLocalStorageSync(storageKey);
      if (legacy.length) {
        setEmails(legacy);
        try {
          await idbPutMonthEmails(storageKey, legacy.map(stripHeavyFieldsForStorage));
          localStorage.removeItem(storageKey);
        } catch (e) {
          console.warn("useGmailMessages: migrate legacy cache to IndexedDB failed:", e);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storageKey, useLocal]);

  const fetchEmails = useCallback(async () => {
    if (!from.trim()) {
      setEmails([]);
      if (storageKey) {
        if (useLocal) {
          void idbDeleteMonthEmails(storageKey);
          try {
            localStorage.removeItem(storageKey);
          } catch {
            /* ignore */
          }
        } else {
          getStorage(storageKey, useLocal).removeItem(storageKey);
        }
      }
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await getGmailMessages({
        from: from.trim(),
        subject,
        newerThanDays,
        afterDate,
        beforeDate,
        maxResults,
        includeCsv,
      });
      const list = data ?? [];
      if (storageKey && useLocal) {
        setEmails((prev) => {
          const byId = new Map(prev.map((e) => [e.id, e]));
          for (const e of list) byId.set(e.id, e);
          const merged = Array.from(byId.values()).sort(
            (a, b) => (Number(a.internalDate) || 0) - (Number(b.internalDate) || 0)
          );
          return persistMessages(storageKey, useLocal, merged);
        });
      } else {
        if (storageKey) {
          setEmails(persistMessages(storageKey, useLocal, list));
        } else {
          setEmails(list);
        }
      }
    } catch (e) {
      setEmails([]);
      setError(e instanceof Error ? e.message : "Failed to load emails");
    } finally {
      setLoading(false);
    }
  }, [from, subject, newerThanDays, afterDate, beforeDate, maxResults, includeCsv, storageKey, useLocal]);

  useEffect(() => {
    if (enabled && from.trim()) fetchEmails();
    else if (!storageKey) setEmails([]);
  }, [enabled, fetchEmails, from, storageKey]);

  const refetchDateRange = useCallback(
    async (rangeAfter: string, rangeBefore: string) => {
      if (!from.trim()) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getGmailMessages({
          from: from.trim(),
          subject,
          afterDate: rangeAfter,
          beforeDate: rangeBefore,
          maxResults,
          includeCsv,
        });
        const newList = data ?? [];
        setEmails((prev) => {
          const byId = new Map(prev.map((e) => [e.id, e]));
          for (const e of newList) byId.set(e.id, e);
          const merged = Array.from(byId.values()).sort(
            (a, b) => (Number(a.internalDate) || 0) - (Number(b.internalDate) || 0)
          );
          if (storageKey) return persistMessages(storageKey, useLocal, merged);
          return merged;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch date range");
      } finally {
        setLoading(false);
      }
    },
    [from, subject, includeCsv, storageKey, useLocal, maxResults]
  );

  return { emails, loading, error, refetch: fetchEmails, refetchDateRange };
}
