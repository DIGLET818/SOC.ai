import { useCallback, useState } from "react";
import {
  getReportAlerts,
  ReportAlertsAuthError,
  type ReportAlertOverrideRecord,
  type ReportAlertsResponse,
  type ReportAlertsSummary,
} from "@/api/reportAlerts";
import type { OverrideField } from "@/api/weeklyReports";
import type { CsvAttachment } from "@/types/gmail";

export function useReportAlertsByDate() {
  const [alertsCsv, setAlertsCsv] = useState<CsvAttachment | null>(null);
  const [overrides, setOverrides] = useState<Record<string, ReportAlertOverrideRecord>>({});
  const [summary, setSummary] = useState<ReportAlertsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setLocalOverride = useCallback(
    (rowKey: string, field: OverrideField, value: string) => {
      setOverrides((prev) => {
        const cur = prev[rowKey] ?? {
          status: null,
          closure_comment: null,
          closure_date: null,
          updatedBy: null,
          updatedAt: null,
        };
        return {
          ...prev,
          [rowKey]: {
            ...cur,
            [field]: value || null,
            updatedAt: new Date().toISOString(),
          },
        };
      });
    },
    []
  );

  const loadRange = useCallback(async (afterDate: string, beforeDate: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp: ReportAlertsResponse = await getReportAlerts({ afterDate, beforeDate });
      setAlertsCsv(resp.alerts.rows.length ? resp.alerts : null);
      setOverrides(resp.overrides);
      setSummary(resp.summary);
    } catch (err) {
      if (err instanceof ReportAlertsAuthError) {
        setError("Authentication required. Reconnect Gmail to load report alerts.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to load alerts");
      }
      setAlertsCsv(null);
      setOverrides({});
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return { alertsCsv, overrides, summary, loading, error, loadRange, setLocalOverride };
}
