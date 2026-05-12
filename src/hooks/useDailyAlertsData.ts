/**
 * Server-backed replacement for `useGmailMessages` on Daily Alerts + Jira Tickets.
 *
 * Differences vs. useGmailMessages:
 *   - No IndexedDB / sessionStorage / localStorage caches at all. The DB is
 *     the source of truth for the alert rows AND the analyst overrides AND
 *     the per-row Jira ticket mapping.
 *   - Loads from /api/daily-alerts on mount whenever `afterDate`/`beforeDate`
 *     change, so navigating between months is automatically populated from
 *     the server (no manual "Refresh" required to see what's already cached).
 *   - `refetchFromGmail()` triggers a Gmail-side sync via /sync, then
 *     re-reads from the DB. Same shape as the Weekly Reports hook.
 *   - Returns `overrides` AND `jiraCreated` straight from the server -- the
 *     pages read them instead of separately mirroring localStorage.
 *
 * Other pages (Weekly Reports, Incidents) continue to use their own hooks /
 * IndexedDB; this hook is intentionally scoped to the daily-alerts dataset.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DailyAlertsAuthError,
  getDailyAlerts,
  syncDailyAlerts,
  type DailyOverrideRecord,
  type JiraCreatedRecord,
} from "@/api/dailyAlerts";
import { getCurrentUser, type CurrentUser } from "@/api/weeklyReports";
import type { GmailMessage } from "@/types/gmail";

export interface UseDailyAlertsDataParams {
  /** Inclusive start (YYYY-MM-DD). */
  afterDate: string;
  /** Exclusive end (YYYY-MM-DD). */
  beforeDate: string;
  /** Hard cap on emails the sync endpoint will pull from Gmail in one shot. */
  maxResults?: number;
}

export interface UseDailyAlertsDataResult {
  emails: GmailMessage[];
  overrides: Record<string, DailyOverrideRecord>;
  jiraCreated: Record<string, JiraCreatedRecord>;
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
  /** Optimistically merge a Jira-created mapping into the local map. */
  setLocalJiraCreated: (
    messageId: string,
    rowIndex: number,
    record: Partial<JiraCreatedRecord> & { jiraKey: string }
  ) => void;
}

export function useDailyAlertsData({
  afterDate,
  beforeDate,
  maxResults = 2000,
}: UseDailyAlertsDataParams): UseDailyAlertsDataResult {
  const [emails, setEmails] = useState<GmailMessage[]>([]);
  const [overrides, setOverrides] = useState<Record<string, DailyOverrideRecord>>({});
  const [jiraCreated, setJiraCreated] = useState<Record<string, JiraCreatedRecord>>({});
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
        console.warn("useDailyAlertsData: queued task failed:", err);
      });
    ioChainRef.current = next;
    return next;
  }, []);

  const loadFromDb = useCallback(
    async (after: string, before: string) => {
      setLoading(true);
      setError(null);
      try {
        const resp = await getDailyAlerts({ afterDate: after, beforeDate: before });
        setEmails(resp.emails);
        setOverrides(resp.overrides);
        setJiraCreated(resp.jiraCreated);
      } catch (err) {
        if (err instanceof DailyAlertsAuthError) {
          setCurrentUser("anonymous");
          setError("Authentication required. Reconnect Gmail to access daily alerts.");
        } else {
          setError(err instanceof Error ? err.message : "Failed to load daily alerts");
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
        await syncDailyAlerts({ afterDate, beforeDate, maxResults });
        await loadFromDb(afterDate, beforeDate);
      } catch (err) {
        if (err instanceof DailyAlertsAuthError) {
          setCurrentUser("anonymous");
          setError("Authentication required. Reconnect Gmail to sync daily alerts.");
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
          await syncDailyAlerts({
            afterDate: rangeAfter,
            beforeDate: rangeBefore,
            maxResults,
          });
          // After a single-day sync, reload the wider current view so newly-fetched
          // emails appear inside the displayed range.
          await loadFromDb(afterDate, beforeDate);
        } catch (err) {
          if (err instanceof DailyAlertsAuthError) {
            setCurrentUser("anonymous");
            setError("Authentication required. Reconnect Gmail to sync daily alerts.");
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

  const setLocalJiraCreated = useCallback(
    (
      messageId: string,
      rowIndex: number,
      record: Partial<JiraCreatedRecord> & { jiraKey: string }
    ) => {
      setJiraCreated((prev) => {
        const key = `${messageId}-r${rowIndex}`;
        const existing = prev[key] ?? {
          messageId,
          rowIndex,
          jiraKey: "",
          jiraUrl: null,
          incidentId: null,
          servicenowTicket: null,
          createdBy: null,
          createdAt: null,
        };
        return {
          ...prev,
          [key]: {
            ...existing,
            ...record,
            messageId,
            rowIndex,
          },
        };
      });
    },
    []
  );

  /** Identify the session once on mount; don't hard-fail the page if anonymous. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const me = await getCurrentUser();
        if (cancelled) return;
        setCurrentUser(me ?? "anonymous");
      } catch (err) {
        if (cancelled) return;
        console.warn("useDailyAlertsData: /me failed:", err);
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
    jiraCreated,
    loading,
    syncing,
    error,
    currentUser,
    reload,
    refetchFromGmail,
    refetchDateRange,
    setLocalOverride,
    setLocalJiraCreated,
  };
}
