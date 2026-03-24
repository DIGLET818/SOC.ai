import { useState, useMemo } from "react";
import { SiemUseCase } from "@/types/siemUseCase";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, RefreshCw } from "lucide-react";

interface SiemUseCaseTableProps {
    useCases: SiemUseCase[];
    monthColumns: string[];
    onFetchAllIncidents?: () => void;
    onFetchRuleIncident?: (ruleId: string, ruleName: string) => void;
    onUpdateUseCase?: (id: string, field: keyof SiemUseCase | string, value: string) => void;
}

export function SiemUseCaseTable({ useCases, monthColumns, onFetchAllIncidents, onFetchRuleIncident, onUpdateUseCase }: SiemUseCaseTableProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [ruleConditionSearch, setRuleConditionSearch] = useState("");
    const [severityFilter, setSeverityFilter] = useState("all");
    const [logSourceFilter, setLogSourceFilter] = useState("all");
    const [teamFilter, setTeamFilter] = useState("all");
    const [alertReceivedFilter, setAlertReceivedFilter] = useState("all");
    const [editingCell, setEditingCell] = useState<{ id: string; field: string } | null>(null);
    const [editValue, setEditValue] = useState("");
    // Local edits storage for when onUpdateUseCase is not provided
    const [localEdits, setLocalEdits] = useState<Record<string, Record<string, string>>>({});

    const handleCellClick = (id: string, field: string, currentValue: string) => {
        setEditingCell({ id, field });
        setEditValue(currentValue || "");
    };

    const handleCellBlur = () => {
        if (editingCell) {
            if (onUpdateUseCase) {
                onUpdateUseCase(editingCell.id, editingCell.field, editValue);
            }
            // Always store locally to persist the edit
            setLocalEdits(prev => ({
                ...prev,
                [editingCell.id]: {
                    ...prev[editingCell.id],
                    [editingCell.field]: editValue
                }
            }));
        }
        setEditingCell(null);
        setEditValue("");
    };

    // Helper to get the current value (local edit or original)
    const getCellValue = (id: string, field: string, originalValue: string): string => {
        return localEdits[id]?.[field] ?? originalValue;
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleCellBlur();
        } else if (e.key === "Escape") {
            setEditingCell(null);
            setEditValue("");
        }
    };

    const renderEditableCell = (id: string, field: string, originalValue: string, className?: string) => {
        const isEditing = editingCell?.id === id && editingCell?.field === field;
        const value = getCellValue(id, field, originalValue);
        const isEmpty = !value || value === "-" || value.trim() === "";

        if (isEditing) {
            return (
                <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={handleCellBlur}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-background border border-primary rounded px-1 py-0.5 text-sm focus:outline-none"
                />
            );
        }

        // Show actual content if not empty, otherwise show editable placeholder
        if (!isEmpty) {
            return (
                <span
                    onClick={() => handleCellClick(id, field, value)}
                    className={`cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded inline-block ${className || ""}`}
                >
                    {value}
                </span>
            );
        }

        // Empty cell - show clickable placeholder
        return (
            <span
                onClick={() => handleCellClick(id, field, "")}
                className={`cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded min-w-[40px] min-h-[20px] inline-flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/60 hover:border hover:border-dashed hover:border-muted-foreground/30 transition-all ${className || ""}`}
                title="Click to edit"
            >
                ◆
            </span>
        );
    };

    const renderEditableSeverityCell = (id: string, originalValue: string) => {
        const isEditing = editingCell?.id === id && editingCell?.field === "pbSeverity";
        const value = getCellValue(id, "pbSeverity", originalValue);
        const isEmpty = !value || value === "-" || value.trim() === "";

        if (isEditing) {
            return (
                <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={handleCellBlur}
                    onKeyDown={handleKeyDown}
                    className="w-full bg-background border border-primary rounded px-1 py-0.5 text-sm focus:outline-none"
                />
            );
        }

        if (!isEmpty) {
            return (
                <Badge
                    variant={getSeverityColor(value)}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => handleCellClick(id, "pbSeverity", value)}
                >
                    {value}
                </Badge>
            );
        }

        // Empty severity - show clickable placeholder
        return (
            <span
                onClick={() => handleCellClick(id, "pbSeverity", "")}
                className="cursor-pointer hover:bg-muted/50 px-1 py-0.5 rounded min-w-[40px] min-h-[20px] inline-flex items-center justify-center text-muted-foreground/40 hover:text-muted-foreground/60 hover:border hover:border-dashed hover:border-muted-foreground/30 transition-all"
                title="Click to edit"
            >
                ◆
            </span>
        );
    };

    // Extract unique values for filters (normalize empty to "__empty__")
    const uniqueSeverities = useMemo(() => {
        const severities = new Set(
            useCases.map((uc) => (uc.pbSeverity?.trim() || "__empty__"))
        );
        return Array.from(severities).sort();
    }, [useCases]);

    const uniqueLogSources = useMemo(() => {
        const sources = new Set(
            useCases.map((uc) => (uc.logSource?.trim() || "__empty__"))
        );
        return Array.from(sources).sort();
    }, [useCases]);

    const uniqueTeams = useMemo(() => {
        const teams = new Set(
            useCases.map((uc) => (uc.team?.trim() || "__empty__"))
        );
        return Array.from(teams).sort();
    }, [useCases]);

    const uniqueAlertReceived = useMemo(() => {
        const alerts = new Set(
            useCases.map((uc) => (uc.alertReceived?.trim() || "__empty__"))
        );
        return Array.from(alerts).sort();
    }, [useCases]);

    // Apply filters
    const filteredUseCases = useMemo(() => {
        return useCases.filter((useCase) => {
            const matchesSearch = useCase.ruleName
                .toLowerCase()
                .includes(searchTerm.toLowerCase());

            const matchesRuleCondition = useCase.ruleCondition
                .toLowerCase()
                .includes(ruleConditionSearch.toLowerCase());

            const pb = useCase.pbSeverity?.trim() || "";
            const ls = useCase.logSource?.trim() || "";
            const tm = useCase.team?.trim() || "";
            const ar = useCase.alertReceived?.trim() || "";

            const matchesSeverity =
                severityFilter === "all" ||
                (severityFilter === "__empty__"
                    ? pb === ""
                    : pb === severityFilter);

            const matchesLogSource =
                logSourceFilter === "all" ||
                (logSourceFilter === "__empty__"
                    ? ls === ""
                    : ls === logSourceFilter);

            const matchesTeam =
                teamFilter === "all" ||
                (teamFilter === "__empty__"
                    ? tm === ""
                    : tm === teamFilter);

            const matchesAlertReceived =
                alertReceivedFilter === "all" ||
                (alertReceivedFilter === "__empty__"
                    ? ar === ""
                    : ar === alertReceivedFilter);

            return matchesSearch && matchesRuleCondition && matchesSeverity && matchesLogSource && matchesTeam && matchesAlertReceived;
        });
    }, [useCases, searchTerm, ruleConditionSearch, severityFilter, logSourceFilter, teamFilter, alertReceivedFilter]);

    const getSeverityColor = (severity: string) => {
        const s = severity.toLowerCase();
        if (s === "high" || s === "critical") return "destructive";
        if (s === "medium") return "default";
        return "secondary";
    };

    if (useCases.length === 0) {
        return (
            <Card className="p-12 text-center">
                <p className="text-muted-foreground text-lg">
                    Upload a SIEM use case spreadsheet to get started
                </p>
            </Card>
        );
    }

    return (
        <div className="flex flex-col h-full gap-3">
            {/* Filters */}
            <Card className="p-4">
                <div className="flex flex-wrap gap-3 items-center">
                    <div className="w-[200px]">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by rule name..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                    </div>
                    <div className="w-[140px]">
                        <Select
                            value={severityFilter}
                            onValueChange={setSeverityFilter}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Severity" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Severities</SelectItem>
                                {uniqueSeverities.map((severity) => (
                                    <SelectItem key={severity} value={severity}>
                                        {severity === "__empty__"
                                            ? "Unknown / Empty"
                                            : severity}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="w-[200px]">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by rule condition..."
                                value={ruleConditionSearch}
                                onChange={(e) => setRuleConditionSearch(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                    </div>
                    <div className="w-[140px]">
                        <Select
                            value={logSourceFilter}
                            onValueChange={setLogSourceFilter}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Log Source" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Sources</SelectItem>
                                {uniqueLogSources.map((source) => (
                                    <SelectItem key={source} value={source}>
                                        {source === "__empty__"
                                            ? "Unknown / Empty"
                                            : source}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="w-[140px]">
                        <Select
                            value={teamFilter}
                            onValueChange={setTeamFilter}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Team" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Teams</SelectItem>
                                {uniqueTeams.map((team) => (
                                    <SelectItem key={team} value={team}>
                                        {team === "__empty__"
                                            ? "Unknown / Empty"
                                            : team}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="w-[140px]">
                        <Select
                            value={alertReceivedFilter}
                            onValueChange={setAlertReceivedFilter}
                        >
                            <SelectTrigger>
                                <SelectValue placeholder="Alert Received" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Alerts</SelectItem>
                                {uniqueAlertReceived.map((alert) => (
                                    <SelectItem key={alert} value={alert}>
                                        {alert === "__empty__"
                                            ? "Unknown / Empty"
                                            : alert}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="text-sm text-muted-foreground ml-auto">
                        Rows: {filteredUseCases.length}
                    </div>
                </div>
            </Card>

            {/* Table with sticky header */}
            <div className="rounded-lg border bg-card flex-1 flex flex-col min-h-0">
                <div className="overflow-auto flex-1">
                    <table className="w-full caption-bottom text-sm border-collapse">
                        <thead className="sticky top-0 z-20 bg-background shadow-sm">
                            <tr className="border-b border-border">
                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground min-w-[200px] bg-background sticky left-0 z-30">
                                    Rule Name
                                </th>
                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground bg-background">
                                    PB-Severity
                                </th>
                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground min-w-[200px] bg-background">
                                    Rule Condition
                                </th>
                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground bg-background">
                                    Log Source
                                </th>
                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground bg-background">
                                    Team
                                </th>
                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground bg-background">
                                    Alert Received
                                </th>
                                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground min-w-[150px] bg-background">
                                    Remarks
                                </th>
                                {monthColumns.map((month) => (
                                    <th
                                        key={month}
                                        className="h-12 px-4 text-center align-middle font-medium text-muted-foreground min-w-[100px] bg-background"
                                    >
                                        {month}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUseCases.map((useCase) => (
                                <tr key={useCase.id} className="border-b border-border transition-colors hover:bg-muted/50 group">
                                    <td className="p-4 align-middle font-medium bg-card sticky left-0 z-10">
                                        <div className="flex items-center gap-2">
                                            <span>{useCase.ruleName}</span>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                                onClick={() => onFetchRuleIncident?.(useCase.id, useCase.ruleName)}
                                            >
                                                <RefreshCw className="h-3 w-3" />
                                            </Button>
                                        </div>
                                    </td>
                                    <td className="p-4 align-middle">
                                        {renderEditableSeverityCell(useCase.id, useCase.pbSeverity)}
                                    </td>
                                    <td className="p-4 align-middle text-sm">
                                        {renderEditableCell(useCase.id, "ruleCondition", useCase.ruleCondition)}
                                    </td>
                                    <td className="p-4 align-middle">
                                        {renderEditableCell(useCase.id, "logSource", useCase.logSource)}
                                    </td>
                                    <td className="p-4 align-middle">
                                        {renderEditableCell(useCase.id, "team", useCase.team)}
                                    </td>
                                    <td className="p-4 align-middle">
                                        {renderEditableCell(useCase.id, "alertReceived", useCase.alertReceived)}
                                    </td>
                                    <td className="p-4 align-middle text-sm text-muted-foreground">
                                        {renderEditableCell(useCase.id, "remarks", useCase.remarks)}
                                    </td>
                                    {monthColumns.map((month) => (
                                        <td key={month} className="p-4 align-middle text-center">
                                            {renderEditableCell(useCase.id, `monthlyData.${month}`, String(useCase.monthlyData[month] || ""))}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
