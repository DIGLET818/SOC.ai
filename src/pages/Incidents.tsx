import { useMemo, useState, useEffect } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { InboxEmailsList } from "@/components/InboxEmailsList";
import { EmailDetailSheet } from "@/components/EmailDetailSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, RefreshCw, ChevronLeft, ChevronRight, CalendarIcon, Search } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { API_BASE_URL } from "@/api/client";
import { useGmailMessages } from "@/hooks/useGmailMessages";
import type { GmailMessage } from "@/types/gmail";

const PAGE_SIZE = 20;

/** Extract Case ID from subject for filtering */
function getCaseIdFromSubject(subject: string): string {
  if (!subject?.trim()) return "";
  const m = subject.match(/Case:\s*([A-Za-z0-9-]+)/i);
  return m ? m[1].trim() : "";
}

function parseEmailDate(email: GmailMessage): number {
  const d = email.date ? new Date(email.date) : null;
  return d && !Number.isNaN(d.getTime()) ? d.getTime() : 0;
}

const NTT_SENDER = "nttin.support@global.ntt";

export default function Incidents() {
    const {
        emails: nttEmails,
        loading: nttEmailsLoading,
        error: nttEmailsError,
        refetch: refetchNttEmails,
    } = useGmailMessages({
        from: NTT_SENDER,
        newerThanDays: 5,
        maxResults: 500,
        enabled: false,
        // No storageKey: 500 emails exceed browser storage quota; list is refetched on Refresh.
    });

    const [selectedNttEmail, setSelectedNttEmail] = useState<GmailMessage | null>(null);

    // Search/filter for NTT emails
    const [caseIdFilter, setCaseIdFilter] = useState("");
    const [subjectFilter, setSubjectFilter] = useState("");
    const [dateFrom, setDateFrom] = useState<Date | undefined>(undefined);
    const [dateTo, setDateTo] = useState<Date | undefined>(undefined);
    const [page, setPage] = useState(1);

    const filteredEmails = useMemo(() => {
        return nttEmails.filter((email) => {
            const caseId = getCaseIdFromSubject(email.subject ?? "").toLowerCase();
            const subject = (email.subject ?? "").toLowerCase();
            const qCase = caseIdFilter.trim().toLowerCase();
            const qSubj = subjectFilter.trim().toLowerCase();
            if (qCase && !caseId.includes(qCase)) return false;
            if (qSubj && !subject.includes(qSubj)) return false;
            const ts = parseEmailDate(email);
            if (dateFrom && ts < dateFrom.getTime()) return false;
            if (dateTo) {
                const toEnd = new Date(dateTo);
                toEnd.setHours(23, 59, 59, 999);
                if (ts > toEnd.getTime()) return false;
            }
            return true;
        });
    }, [nttEmails, caseIdFilter, subjectFilter, dateFrom, dateTo]);

    const totalFiltered = filteredEmails.length;
    const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    useEffect(() => {
        if (page > totalPages && totalPages >= 1) setPage(totalPages);
    }, [totalPages, page]);
    const paginatedEmails = useMemo(
        () => filteredEmails.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
        [filteredEmails, currentPage]
    );

    const handleClearEmailFilters = () => {
        setCaseIdFilter("");
        setSubjectFilter("");
        setDateFrom(undefined);
        setDateTo(undefined);
        setPage(1);
    };

    return (
        <SidebarProvider>
            <SOCSidebar />
            <SidebarInset>
                <div className="flex flex-col min-h-screen bg-background">
                    {/* HEADER */}
                    <header className="sticky top-0 border-b bg-background/95">
                        <div className="flex h-16 items-center justify-between px-6">
                            <div>
                                <h1 className="text-2xl font-bold">Incident Management</h1>
                                <p className="text-sm text-muted-foreground">
                                    Track, analyze & resolve security incidents
                                </p>
                            </div>

                            <div className="flex gap-3">
                                <Button size="sm" variant="outline" onClick={refetchNttEmails}>
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    Refresh
                                </Button>
                                <Button size="sm">
                                    <Plus className="h-4 w-4 mr-2" />
                                    New Incident
                                </Button>
                                <ThemeToggle />
                                <NotificationsPanel />
                            </div>
                        </div>
                    </header>

                    {/* MAIN */}
                    <main className="min-w-0 flex-1 p-6 space-y-6">
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-3">
                                <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                                <Input
                                    placeholder="Filter by Case ID"
                                    value={caseIdFilter}
                                    onChange={(e) => { setCaseIdFilter(e.target.value); setPage(1); }}
                                    className="max-w-[180px] h-9"
                                />
                                <Input
                                    placeholder="Filter by Subject"
                                    value={subjectFilter}
                                    onChange={(e) => { setSubjectFilter(e.target.value); setPage(1); }}
                                    className="max-w-[240px] h-9"
                                />
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant="outline" size="sm" className={cn("h-9 justify-start text-left font-normal", (!dateFrom && !dateTo) && "text-muted-foreground")}>
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {dateFrom && dateTo
                                                ? `${format(dateFrom, "MMM d")} – ${format(dateTo, "MMM d")}`
                                                : dateFrom
                                                    ? format(dateFrom, "MMM d")
                                                    : "Filter by date"}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <div className="p-2 space-y-2">
                                            <p className="text-xs font-medium text-muted-foreground">From</p>
                                            <Calendar mode="single" selected={dateFrom} onSelect={(d) => { setDateFrom(d ?? undefined); setPage(1); }} />
                                            <p className="text-xs font-medium text-muted-foreground pt-2">To</p>
                                            <Calendar mode="single" selected={dateTo} onSelect={(d) => { setDateTo(d ?? undefined); setPage(1); }} />
                                        </div>
                                    </PopoverContent>
                                </Popover>
                                {(caseIdFilter || subjectFilter || dateFrom || dateTo) && (
                                    <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={handleClearEmailFilters}>
                                        Clear filters
                                    </Button>
                                )}
                            </div>
                            <div className="flex items-center justify-between gap-4">
                                <p className="text-sm text-muted-foreground">
                                    Total: <span className="font-semibold text-foreground">{totalFiltered}</span> alert{totalFiltered !== 1 ? "s" : ""}
                                </p>
                                {totalPages > 1 && (
                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={currentPage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                                            <ChevronLeft className="h-4 w-4" />
                                        </Button>
                                        <span className="text-sm text-muted-foreground min-w-[80px] text-center">
                                            Page {currentPage} of {totalPages}
                                        </span>
                                        <Button variant="outline" size="sm" className="h-8 w-8 p-0" disabled={currentPage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <InboxEmailsList
                            emails={paginatedEmails}
                            loading={nttEmailsLoading}
                            error={nttEmailsError}
                            onRefresh={refetchNttEmails}
                            onEmailClick={setSelectedNttEmail}
                            selectedEmailId={selectedNttEmail?.id ?? null}
                            title="Emails from NTT (last 5 days)"
                            senderLabel={NTT_SENDER}
                            reconnectGmailUrl={`${API_BASE_URL}/auth/google`}
                        />

                        <EmailDetailSheet
                            email={selectedNttEmail}
                            open={!!selectedNttEmail}
                            onClose={() => setSelectedNttEmail(null)}
                        />
                    </main>
                </div>
            </SidebarInset>
        </SidebarProvider>
    );
}
