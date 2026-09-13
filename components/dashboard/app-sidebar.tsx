"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LineChart,
  Radar,
  Receipt,
  BarChart3,
  FlaskConical,
  GitBranch,
  BookOpen,
  GraduationCap,
  Activity,
  Newspaper,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const NAV_ITEMS = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Markets", url: "/markets", icon: LineChart },
  { title: "Signals", url: "/signals", icon: Radar },
  { title: "Trades", url: "/trades", icon: Receipt },
  { title: "Performance", url: "/performance", icon: BarChart3 },
  { title: "Backtests", url: "/backtests", icon: FlaskConical },
  { title: "Strategies", url: "/strategies", icon: GitBranch },
  { title: "Knowledge", url: "/knowledge", icon: BookOpen },
  { title: "News", url: "/news", icon: Newspaper },
  { title: "Learn", url: "/learn", icon: GraduationCap },
  { title: "System", url: "/system", icon: Activity },
];

export function AppSidebar({ role }: { role: "owner" | "guest" }) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="bg-primary text-primary-foreground flex size-7 items-center justify-center rounded-md text-sm font-semibold">
            D
          </div>
          <span className="text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
            Davinki Coach
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Trading</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    render={<Link href={item.url} />}
                    isActive={pathname.startsWith(item.url)}
                    tooltip={item.title}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {role === "owner" ? <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/settings/access" />}
              isActive={pathname.startsWith("/settings/access")}
              tooltip="Guest access"
            >
              <Users />
              <span>Guest access</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/settings/risk" />}
              isActive={pathname.startsWith("/settings/risk")}
              tooltip="Risk settings"
            >
              <ShieldCheck />
              <span>Risk settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={<Link href="/settings/connections" />}
              isActive={pathname.startsWith("/settings/connections")}
              tooltip="Settings"
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter> : null}
    </Sidebar>
  );
}
