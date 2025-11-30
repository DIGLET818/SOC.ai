import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { SOCSidebar } from "@/components/SOCSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UserRoleManagement } from "@/components/UserRoleManagement";
import { APIIntegrations } from "@/components/APIIntegrations";
import { NotificationSettings } from "@/components/NotificationSettings";
import { AutomationRules } from "@/components/AutomationRules";

export default function Settings() {
  return (
    <SidebarProvider>
      <SOCSidebar />
      <SidebarInset>
        <div className="flex flex-col min-h-screen bg-background">
          <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex h-16 items-center justify-between px-6">
              <div>
                <h1 className="text-2xl font-bold text-foreground">SOC Settings</h1>
                <p className="text-sm text-muted-foreground">Configure integrations, users, and automation</p>
              </div>
              <div className="flex items-center gap-3">
                <ThemeToggle />
                <NotificationsPanel />
              </div>
            </div>
          </header>

          <main className="flex-1 p-6">
            <Tabs defaultValue="users" className="space-y-6">
              <TabsList>
                <TabsTrigger value="users">Users & Roles</TabsTrigger>
                <TabsTrigger value="integrations">API Integrations</TabsTrigger>
                <TabsTrigger value="notifications">Notifications</TabsTrigger>
                <TabsTrigger value="automation">Automation</TabsTrigger>
              </TabsList>

              <TabsContent value="users">
                <UserRoleManagement />
              </TabsContent>

              <TabsContent value="integrations">
                <APIIntegrations />
              </TabsContent>

              <TabsContent value="notifications">
                <NotificationSettings />
              </TabsContent>

              <TabsContent value="automation">
                <AutomationRules />
              </TabsContent>
            </Tabs>
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
