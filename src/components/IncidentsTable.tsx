import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Case } from "@/types/case";
import { SeverityBadge } from "./SeverityBadge";
import { StatusBadge } from "./StatusBadge";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";

interface IncidentsTableProps {
    data?: Case[];
    severity: string;
    status: string;
    assignedAnalyst: string;
    mitreTactic: string;
    dateRange: { from: Date | undefined; to: Date | undefined };
    onIncidentClick: (incident: Case) => void;

    onViewTimeline?: (incident: Case) => void;
    onCloseCase?: (id: string) => void;
    onAssignCase?: (id: string, analyst: string) => void;
}

export function IncidentsTable({
    data,
    severity,
    status,
    assignedAnalyst,
    mitreTactic,
    dateRange,
    onIncidentClick,
    onViewTimeline,
    onCloseCase,
    onAssignCase,
}: IncidentsTableProps) {

    /* ===============================
       REAL BACKEND DATA ONLY
       =============================== */
    const cases: Case[] = Array.isArray(data) ? data : [];

    /* ===============================
       EMPTY STATE (MAIL NOT YET FOUND)
       =============================== */
    if (!cases.length) {
        return (
            <Card className="p-10 text-center text-muted-foreground">
                <p className="text-sm font-medium">No incidents found</p>
                <p className="text-xs mt-1">
                    Waiting for alerts fetched from mailbox…
                </p>
            </Card>
        );
    }

    /* ===============================
       FILTERING
       =============================== */
    const filteredCases = cases.filter((incident) => {
        if (severity !== "all" && incident.priority !== severity) return false;
        if (status !== "all" && incident.status !== status) return false;
        if (
            assignedAnalyst !== "all" &&
            incident.assignedAnalyst !== assignedAnalyst
        )
            return false;

        if (mitreTactic !== "all" && incident.mitreTactic !== mitreTactic)
            return false;

        if (dateRange.from || dateRange.to) {
            const incidentDate = new Date(incident.createdAt);
            if (dateRange.from && incidentDate < dateRange.from) return false;
            if (dateRange.to && incidentDate > dateRange.to) return false;
        }

        return true;
    });

    /* ===============================
       RENDER TABLE
       =============================== */
    return (
        <Card className="shadow-lg">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Case ID</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Assigned Analyst</TableHead>
                        <TableHead>AI Priority</TableHead>
                        <TableHead>Last Updated</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>

                <TableBody>
                    {filteredCases.map((incident, index) => {
                        const rowKey =
                            incident.id ??
                            incident.caseId ??
                            incident.offenseId ??
                            `incident-${index}`;

                        return (
                            <TableRow
                                key={rowKey}
                                className="cursor-pointer hover:bg-muted/50 transition-colors"
                            >
                                <TableCell
                                    className="font-mono text-xs"
                                    onClick={() => onIncidentClick(incident)}
                                >
                                    {incident.id ?? incident.caseId ?? incident.offenseId}
                                </TableCell>

                                <TableCell onClick={() => onIncidentClick(incident)}>
                                    {incident.title}
                                </TableCell>

                                <TableCell onClick={() => onIncidentClick(incident)}>
                                    <SeverityBadge severity={incident.priority} />
                                </TableCell>

                                <TableCell onClick={() => onIncidentClick(incident)}>
                                    <StatusBadge status={incident.status} />
                                </TableCell>

                                <TableCell onClick={() => onIncidentClick(incident)}>
                                    {incident.assignedAnalyst}
                                </TableCell>

                                <TableCell>
                                    <Badge
                                        variant="outline"
                                        className="bg-primary/10 text-primary border-primary/20"
                                    >
                                        {Math.floor(Math.random() * 30) + 70}/100
                                    </Badge>
                                </TableCell>

                                <TableCell className="text-sm text-muted-foreground">
                                    {new Date(incident.updatedAt).toLocaleString()}
                                </TableCell>

                                <TableCell className="text-right">
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <button className="p-2 rounded hover:bg-muted">
                                                <MoreHorizontal className="h-4 w-4" />
                                            </button>
                                        </DropdownMenuTrigger>

                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem
                                                onClick={() => onViewTimeline?.(incident)}
                                            >
                                                View Timeline
                                            </DropdownMenuItem>

                                            <DropdownMenuItem
                                                onClick={() =>
                                                    onAssignCase?.(incident.id, "Analyst A")
                                                }
                                            >
                                                Assign Case
                                            </DropdownMenuItem>

                                            <DropdownMenuItem
                                                className="text-red-600"
                                                onClick={() => onCloseCase?.(incident.id)}
                                            >
                                                Close Case
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </TableCell>
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </Card>
    );
}
