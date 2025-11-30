import { useState } from "react";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { IOCSearchBar } from "@/components/IOCSearchBar";
import { IOCEnrichmentResults } from "@/components/IOCEnrichmentResults";
import { ThreatFeedPanel } from "@/components/ThreatFeedPanel";
import { ThreatMapCard } from "@/components/ThreatMapCard";
import { ThreatActorProfiles } from "@/components/ThreatActorProfiles";
import { TopMaliciousIOCs } from "@/components/TopMaliciousIOCs";

export default function ThreatIntel() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchType, setSearchType] = useState<"ip" | "domain" | "hash">("ip");
  const [searchResults, setSearchResults] = useState<any>(null);

  const handleSearch = () => {
    // Simulate IOC lookup
    setSearchResults({
      query: searchQuery,
      type: searchType,
      virustotal: { malicious: 12, suspicious: 3, clean: 45, score: 75 },
      geoip: { country: "Russia", city: "Moscow", asn: "AS12345", org: "ISP Provider" },
      greynoise: { classification: "malicious", tags: ["scanner", "bruteforce"] },
      abuseipdb: { score: 85, reports: 234, lastReported: "2024-01-15" },
      sightings: 127,
    });
  };

  return (
    <SidebarProvider>
      <SOCSidebar />
      <SidebarInset>
        <div className="flex flex-col min-h-screen bg-background">
          <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-16 items-center justify-between px-6">
              <div>
                <h1 className="text-2xl font-bold text-foreground">Threat Intelligence</h1>
                <p className="text-sm text-muted-foreground">IOC enrichment and threat analysis</p>
              </div>
              <div className="flex items-center gap-3">
                <ThemeToggle />
                <NotificationsPanel />
              </div>
            </div>
          </header>

          <main className="flex-1 p-6 space-y-6">
            <IOCSearchBar
              query={searchQuery}
              searchType={searchType}
              onQueryChange={setSearchQuery}
              onSearchTypeChange={setSearchType}
              onSearch={handleSearch}
            />

            {searchResults && (
              <IOCEnrichmentResults results={searchResults} />
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ThreatMapCard />
              <ThreatFeedPanel />
            </div>

            <TopMaliciousIOCs />
            
            <ThreatActorProfiles />
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
