/**
 * Server-backed replacement for `useGmailMessages` on the Weekly Reports page.
 *
 * Differences vs. useGmailMessages:
 *   - No IndexedDB / sessionStorage / localStorage caches at all. The DB is
 *     the source of truth (workspace decision: full replacement).
 *   - Loads from /api/weekly-reports on mount whenever `afterDate`/`beforeDate`
 *     change, so navigating between months is automatically populated from the
 *     server (no manual "Refresh" required to see what's already cached).
 *   - `refetch()` triggers a Gmail-side sync via /sync, then re-reads from DB.
 *   - Returns `overrides` straight from the server -- the page reads them
 *     instead of separately mirroring localStorage.
 *
 * Other pages (DailyAlerts, JiraTickets, Incidents) continue to use the old
 * `useGmailMessages` hook + IndexedDB; this hook is intentionally scoped to
 * Weekly Reports so we don't break them in this change.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCurrentUser,
  getWeeklyReports,
  syncWeeklyReports,
  WeeklyReportsAuthError,
  type CurrentUser,
  type WeeklyOverrideRecord,
} from "@/api/weeklyReports";
import type { GmailMessage } from "@/types/gmail";

export interface UseWeeklyReportDataParams {
  /** Inclusive start (YYYY-MM-DD). */
  afterDate: string;
  /** Exclusive end (YYYY-MM-DD). */
  beforeDate: string;
  /** Hard cap on emails the sync endpoint will pull from Gmail in one shot. */
  maxResults?: number;
}

export interface UseWeeklyReportDataResult {
  emails: GmailMessage[];
  overrides: Record<string, WeeklyOverrideRecord>;
  /** True while the initial DB load for this date range is in flight. */
  loading: boolean;
  /** True while a Gmail-side `/sync` is running (kept separate so the table can stay visible). */
  syncing: boolean;
  error: string | null;
  /** Auth status: null = unknown / loading; user object = signed in; "anonymous" = 401. */
  currentUser: CurrentUser | "anonymous" | null;
  /** Re-read the cached data from the DB (fast). */
  reload: () => Promise<void>;
  /** Pull fresh data from Gmail for the current range, then reload from DB. */
  refetchFromGmail: () => Promise<void>;
  /** Pull fresh data from Gmail for an arbitrary day (or range) and reload. */
  refetchDateRange: (afterDate: string, beforeDate: string) => Promise<void>;
  /** Optimistically merge an override into the local map (for snappy UI after a PATCH). */
  setLocalOverride: (
    messageId: string,
    rowIndex: number,
    field: "status" | "closure_comment" | "closure_date",
    value: string,
    actor?: { email: string }
  ) => void;
}

export function useWeeklyReportData({
  afterDate,
  beforeDate,
  maxResults = 2000,
}: UseWeeklyReportDataParams): UseWeeklyReportDataResult {
  const [emails, setEmails] = useState<GmailMessage[]>([]);
  const [overrides, setOverrides] = useState<Record<string, WeeklyOverrideRecord>>({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | "anonymous" | null>(null);

  /** Serialise concurrent loads/syncs so the latest call wins and races can't shred state. */
  const ioChainRef = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((task: () => Promise<void>) => {
    const next = ioChainRef.current
      .then(task)
      .catch((err) => {
        // Surface unexpected errors but never break the chain.
        console.warn("useWeeklyReportData: queued task failed:", err);
      });
    ioChainRef.current = next;
    return next;
  }, []);

  const loadFromDb = useCallback(
    async (after: string, before: string) => {
      setLoading(true);
      setError(null);
      try {
        const resp = await getWeeklyReports({ afterDate: after, beforeDate: before });
        setEmails(resp.emails);
        setOverrides(resp.overrides);
      } catch (err) {
        if (err instanceof WeeklyReportsAuthError) {
          setCurrentUser("anonymous");
          setError("Authentication required. Reconnect Gmail to access weekly reports.");
        } else {
          setError(err instanceof Error ? err.message : "Failed to load weekly reports");
        }
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const reload = useCallback(() => {
    return enqueue(() => loadFromDb(afterDate, beforeDate));
  }, [enqueue, loadFromDb, afterDate, beforeDate]);

  const refetchFromGmail = useCallback(() => {
    return enqueue(async () => {
      setSyncing(true);
      setError(null);
      try {
        await syncWeeklyReports({ afterDate, beforeDate, maxResults });
        await loadFromDb(afterDate, beforeDate);
      } catch (err) {
        if (err instanceof WeeklyReportsAuthError) {
          setCurrentUser("anonymous");
          setError("Authentication required. Reconnect Gmail to sync weekly reports.");
        } else {
          setError(err instanceof Error ? err.message : "Failed to sync from Gmail");
        }
      } finally {
        setSyncing(false);
      }
    });
  }, [enqueue, afterDate, beforeDate, maxResults, loadFromDb]);

  const refetchDateRange = useCallback(
    (rangeAfter: string, rangeBefore: string) => {
      return enqueue(async () => {
        setSyncing(true);
        setError(null);
        try {
          await syncWeeklyReports({
            afterDate: rangeAfter,
            beforeDate: rangeBefore,
            maxResults,
          });
          // After a single-day sync, reload the wider current view so newly-fetched
          // emails appear inside the displayed range.
          await loadFromDb(afterDate, beforeDate);
        } catch (err) {
          if (err instanceof WeeklyReportsAuthError) {
            setCurrentUser("anonymous");
            setError("Authentication required. Reconnect Gmail to sync weekly reports.");
          } else {
            setError(err instanceof Error ? err.message : "Failed to sync from Gmail");
          }
        } finally {
          setSyncing(false);
        }
      });
    },
    [enqueue, afterDate, beforeDate, maxResults, loadFromDb]
  );

  const setLocalOverride = useCallback(
    (
      messageId: string,
      rowIndex: number,
      field: "status" | "closure_comment" | "closure_date",
      value: string,
      actor?: { email: string }
    ) => {
      setOverrides((prev) => {
        const key = `${messageId}-r${rowIndex}`;
        const existing = prev[key] ?? {
          messageId,
          rowIndex,
          status: null,
          closure_comment: null,
          closure_date: null,
          updatedBy: null,
          updatedAt: null,
        };
        return {
          ...prev,
          [key]: {
            ...existing,
            [field]: value,
            updatedBy: actor?.email ?? existing.updatedBy,
            updatedAt: new Date().toISOString(),
          },
        };
      });
    },
    []
  );

  /** Identify the session once on mount; don't hard-fail the page if anonymous -- /me returns null then. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await getCurrentUser();
        if (cancelled) return;
        setCurrentUser(me ?? "anonymous");
      } catch (err) {
        if (cancelled) return;
        console.warn("useWeeklyReportData: /me failed:", err);
        setCurrentUser("anonymous");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Auto-load whenever the date range changes (no manual Refresh required). */
  useEffect(() => {
    if (!afterDate || !beforeDate) return;
    void enqueue(() => loadFromDb(afterDate, beforeDate));
  }, [afterDate, beforeDate, enqueue, loadFromDb]);

  return {
    emails,
    overrides,
    loading,
    syncing,
    error,
    currentUser,
    reload,
    refetchFromGmail,
    refetchDateRange,
    setLocalOverride,
  };
}
