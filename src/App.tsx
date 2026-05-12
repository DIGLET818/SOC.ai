import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";

import Index from "./pages/Index";
import Incidents from "./pages/Incidents";
import DailyAlerts from "./pages/DailyAlerts";
import WeeklyReports from "./pages/WeeklyReports";
import JiraTickets from "./pages/JiraTickets";
import ThreatIntel from "./pages/ThreatIntel";
import SiemUseCases from "./pages/SiemUseCases";
import Analysis from "./pages/Analysis";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => {
    return (
        <QueryClientProvider client={queryClient}>
            <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
                <TooltipProvider>
                    <Toaster />
                    <Sonner />
                    <BrowserRouter>
                        <Routes>
                            <Route path="/" element={<Index />} />
                            <Route path="/incidents" element={<Incidents />} />
                            <Route path="/daily-alerts" element={<DailyAlerts />} />
                            <Route path="/weekly-reports" element={<WeeklyReports />} />
                            <Route path="/weekly-reports/yearly" element={<WeeklyReports />} />
                            <Route path="/jira-tickets" element={<JiraTickets />} />
                            <Route path="/threat-intel" element={<ThreatIntel />} />
                            <Route path="/siem-use-cases" element={<SiemUseCases />} />
                            <Route path="/analysis" element={<Analysis />} />
                            <Route path="/reports" element={<Reports />} />
                            <Route path="/settings" element={<Settings />} />
                            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                            <Route path="*" element={<NotFound />} />
                        </Routes>
                    </BrowserRouter>
                </TooltipProvider>
            </ThemeProvider>
        </QueryClientProvider>
    );
};

export default App;
