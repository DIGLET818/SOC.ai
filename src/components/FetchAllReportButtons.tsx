import { Button } from "@/components/ui/button";

export type FetchAllProgressState = {
  /** Row index processed (1-based for display). */
  current: number;
  total: number;
  /** Rows where Gmail was queried at least once. */
  gmailChecked?: number;
  /** Rows where status/closure was written from Gmail. */
  updated?: number;
  /** Rows skipped (no ServiceNow / Incident / INC / CS token). */
  skippedNoId?: number;
  /** Rows auto-filled as merged (NTT) without a Gmail lookup. */
  mergedSkipped?: number;
  /** Gmail lookup failures after retries. */
  errors?: number;
  /** Rows still open — Gmail had no closure email (not a failure). */
  noClosureInGmail?: number;
  /** Scan = walking CSV rows; gmail = closure lookup batches. */
  phase?: "scan" | "gmail";
};

function buildFetchAllProgressLabel(progress: FetchAllProgressState): string {
  const skipped = (progress.mergedSkipped ?? 0) + (progress.skippedNoId ?? 0);
  const gmail = progress.gmailChecked ?? 0;
  const updated = progress.updated ?? 0;
  const open = progress.noClosureInGmail ?? 0;
  const parts = [`Row ${progress.current}/${progress.total}`];
  if (skipped > 0) parts.push(`${skipped} merged/skipped`);
  if (progress.gmailChecked != null) {
    parts.push(`Gmail ${gmail}`, `Updated ${updated}`);
  }
  if (open > 0) parts.push(`Open ${open}`);
  if (progress.errors) parts.push(`Errors ${progress.errors}`);
  if (progress.phase === "scan" && gmail === 0) parts.push("scanning…");
  return parts.join(" · ");
}

type FetchAllReportButtonsProps = {
  canResume: boolean;
  /** 1-based row number shown to the user */
  resumeFromRow: number;
  fetching: boolean;
  progress: FetchAllProgressState | null;
  disabled?: boolean;
  fetchAllLabel?: string;
  onResume: () => void;
  onStartFromBeginning: () => void;
};

export function FetchAllReportButtons({
  canResume,
  resumeFromRow,
  fetching,
  progress,
  disabled,
  fetchAllLabel = "Fetch all (this report)",
  onResume,
  onStartFromBeginning,
}: FetchAllReportButtonsProps) {
  const progressLabel =
    fetching && progress
      ? progress.gmailChecked != null
        ? buildFetchAllProgressLabel(progress)
        : `Fetching… ${progress.current}/${progress.total}`
      : null;

  if (fetching) {
    return (
      <Button variant="outline" size="sm" disabled>
        {progressLabel ?? "Fetching…"}
      </Button>
    );
  }

  if (canResume && !fetching) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="default"
          size="sm"
          disabled={disabled}
          onClick={onStartFromBeginning}
          title="Clear saved progress and process every row from row 1"
        >
          Start from row 1
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={onResume}
          title="Continue from where the last run stopped (saved in this browser)"
        >
          Resume from row {resumeFromRow}
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={onStartFromBeginning}
      title="Fetch closure status from Gmail for every row starting at row 1"
    >
      {progressLabel ?? fetchAllLabel}
    </Button>
  );
}
