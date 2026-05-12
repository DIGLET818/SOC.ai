/**
 * Hook to load Gmail messages (e.g. from nttin.support@global.ntt, last 24h).
 * Optional storageKey: persist emails in sessionStorage, or when persistInLocalStorage:
 *   IndexedDB (large quota — much more than localStorage ~5MB) + legacy localStorage migration.
 *
 * IndexedDB writes are awaited and fetches are serialized so hydration/refetch cannot race
 * and overwrite a fuller in-memory merge with a stale IDB read.
 */
import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
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

/** Session / non-IDB persistence (sync). */
function persistSessionStorage(storageKey: string, useLocal: boolean, messages: GmailMessage[]): GmailMessage[] {
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

async function persistIdb(storageKey: string, messages: GmailMessage[]): Promise<void> {
  const stripped = messages.map(stripHeavyFieldsForStorage);
  await idbPutMonthEmails(storageKey, stripped);
  try {
    localStorage.removeItem(storageKey);
  } catch {
    /* ignore */
  }
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

/** Merge by message id; later lists override earlier (API wins over cache). */
function mergeEmailListsById(...lists: (GmailMessage[] | null | undefined)[]): GmailMessage[] {
  const map = new Map<string, GmailMessage>();
  for (const list of lists) {
    if (!list?.length) continue;
    for (const e of list) {
      if (e?.id) map.set(e.id, e);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => (Number(a.internalDate) || 0) - (Number(b.internalDate) || 0)
  );
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
  /**
   * True while the hook is restoring cached emails from IndexedDB / sessionStorage on first mount or after
   * a storageKey change. Use this in the UI to avoid flashing an "empty state" before the cache hydrates.
   */
  isHydratingFromCache: boolean;
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
  /**
   * True while we wait for the async IndexedDB read on first mount (or after a storageKey change).
   * For non-IDB (sessionStorage) we hydrate sync, so it stays false there.
   */
  const [isHydratingFromCache, setIsHydratingFromCache] = useState<boolean>(() =>
    Boolean(storageKey && persistInLocalStorage)
  );

  /** Mirrors `emails` for async merges; layout sync so it matches state before queued IDB/fetch work. */
  const emailsRef = useRef<GmailMessage[]>(DEFAULT_STORAGE);
  useLayoutEffect(() => {
    emailsRef.current = emails;
  }, [emails]);

  /** Serialize IDB hydration + all fetches so nothing reads stale IDB mid-write or overwrites a fuller merge. */
  const ioChainRef = useRef(Promise.resolve());
  const enqueue = useCallback((task: () => Promise<void>) => {
    const next = ioChainRef.current
      .then(task)
      .catch((err) => console.warn("useGmailMessages: queued task failed:", err));
    ioChainRef.current = next;
    return next;
  }, []);

  const prevStorageKeyRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!storageKey) return;
    if (prevStorageKeyRef.current !== undefined && prevStorageKeyRef.current !== storageKey) {
      setEmails([]);
      emailsRef.current = [];
      if (useLocal) setIsHydratingFromCache(true);
    }
    prevStorageKeyRef.current = storageKey;
  }, [storageKey, useLocal]);

  /** IndexedDB / legacy: merge into state — never replace (avoids clobbering a newer refetch). */
  useEffect(() => {
    if (!storageKey || !useLocal) {
      setIsHydratingFromCache(false);
      return;
    }
    void enqueue(async () => {
      try {
        const fromIdb = await idbGetMonthEmails(storageKey);
        if (fromIdb && fromIdb.length > 0) {
          setEmails((prev) => {
            const m = mergeEmailListsById(fromIdb, prev);
            emailsRef.current = m;
            return m;
          });
          try {
            localStorage.removeItem(storageKey);
          } catch {
            /* ignore */
          }
          return;
        }
        const legacy = loadLegacyLocalStorageSync(storageKey);
        if (legacy.length) {
          try {
            await idbPutMonthEmails(storageKey, legacy.map(stripHeavyFieldsForStorage));
            setEmails((prev) => {
              const m = mergeEmailListsById(legacy, prev);
              emailsRef.current = m;
              return m;
            });
            localStorage.removeItem(storageKey);
          } catch (e) {
            console.warn("useGmailMessages: migrate legacy cache to IndexedDB failed:", e);
          }
        }
      } finally {
        setIsHydratingFromCache(false);
      }
    });
  }, [storageKey, useLocal, enqueue]);

  /** Session cache: merge on load (sync). */
  useEffect(() => {
    if (!storageKey || useLocal) return;
    const s = loadFromSessionStorage(storageKey);
    if (s.length) {
      setEmails((prev) => {
        const m = mergeEmailListsById(s, prev);
        emailsRef.current = m;
        return m;
      });
    }
  }, [storageKey, useLocal]);

  const fetchEmails = useCallback(async () => {
    if (!from.trim()) {
      return enqueue(async () => {
        setEmails([]);
        emailsRef.current = [];
        if (storageKey) {
          if (useLocal) {
            await idbDeleteMonthEmails(storageKey);
            try {
              localStorage.removeItem(storageKey);
            } catch {
              /* ignore */
            }
          } else {
            getStorage(storageKey, useLocal).removeItem(storageKey);
          }
        }
      });
    }

    return enqueue(async () => {
      setLoading(true);
      setError(null);
      try {
        let seed: GmailMessage[] = [];
        if (storageKey) {
          if (useLocal) {
            seed = (await idbGetMonthEmails(storageKey)) ?? [];
          } else {
            seed = loadFromSessionStorage(storageKey);
          }
        }

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
        const prev = emailsRef.current;
        const merged = storageKey ? mergeEmailListsById(seed, prev, list) : list;

        if (storageKey && useLocal) {
          await persistIdb(storageKey, merged);
        } else if (storageKey && !useLocal) {
          persistSessionStorage(storageKey, useLocal, merged);
        }
        setEmails(merged);
        emailsRef.current = merged;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load emails");
      } finally {
        setLoading(false);
      }
    });
  }, [from, subject, newerThanDays, afterDate, beforeDate, maxResults, includeCsv, storageKey, useLocal, enqueue]);

  useEffect(() => {
    if (enabled && from.trim()) void fetchEmails();
    else if (!storageKey) setEmails([]);
  }, [enabled, fetchEmails, from, storageKey]);

  const refetchDateRange = useCallback(
    (rangeAfter: string, rangeBefore: string) => {
      if (!from.trim()) return Promise.resolve();
      return enqueue(async () => {
        setLoading(true);
        setError(null);
        try {
          let seed: GmailMessage[] = [];
          if (storageKey) {
            if (useLocal) {
              seed = (await idbGetMonthEmails(storageKey)) ?? [];
            } else {
              seed = loadFromSessionStorage(storageKey);
            }
          }

          const data = await getGmailMessages({
            from: from.trim(),
            subject,
            afterDate: rangeAfter,
            beforeDate: rangeBefore,
            maxResults,
            includeCsv,
          });
          const newList = data ?? [];
          const prev = emailsRef.current;
          const merged = storageKey ? mergeEmailListsById(seed, prev, newList) : newList;

          if (storageKey && useLocal) {
            await persistIdb(storageKey, merged);
          } else if (storageKey && !useLocal) {
            persistSessionStorage(storageKey, useLocal, merged);
          }
          setEmails(merged);
          emailsRef.current = merged;
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to fetch date range");
        } finally {
          setLoading(false);
        }
      });
    },
    [from, subject, includeCsv, storageKey, useLocal, maxResults, enqueue]
  );

  return { emails, loading, error, refetch: fetchEmails, refetchDateRange, isHydratingFromCache };
}
