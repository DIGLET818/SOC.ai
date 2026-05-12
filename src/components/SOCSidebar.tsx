import { Shield, AlertTriangle, FileText, Settings, Activity, FileBarChart, Calendar, CalendarRange, Ticket, LineChart, BarChart3 } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const menuItems = [
  { title: "Alerts", url: "/", icon: AlertTriangle },
  { title: "Incidents", url: "/incidents", icon: Shield },
  { title: "Daily Alerts", url: "/daily-alerts", icon: Calendar },
  { title: "Yearly data", url: "/weekly-reports/yearly", icon: BarChart3 },
  { title: "Weekly Reports", url: "/weekly-reports", icon: CalendarRange },
  { title: "Jira Tickets", url: "/jira-tickets", icon: Ticket },
  { title: "Threat Intelligence", url: "/threat-intel", icon: Activity },
  { title: "SIEM Use case", url: "/siem-use-cases", icon: FileBarChart },
  { title: "Use case Analysis", url: "/analysis", icon: LineChart },
  { title: "Reports", url: "/reports", icon: FileText },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function SOCSidebar() {
  const { open } = useSidebar();

  return (
    <Sidebar className="border-r border-border" collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-primary font-semibold text-base px-4 py-6">
            <Shield className="inline-block mr-2 h-5 w-5" />
            {open && "SOC AI Assistant"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild tooltip={item.title}>
                    <NavLink
                      to={item.url}
                      end
                      className="hover:bg-sidebar-accent transition-colors"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                    >
                      <item.icon className="h-5 w-5" />
                      <span>{item.title}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
