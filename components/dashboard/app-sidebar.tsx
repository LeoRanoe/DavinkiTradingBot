"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  LineChart,
  Radar,
  Receipt,
  CircleDot,
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
import { BrandLockup } from "@/components/dashboard/brand-mark";

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
      { title: "Markets", url: "/markets", icon: LineChart },
    ],
  },
  {
    label: "Trading",
    items: [
      { title: "Candidates", url: "/candidates", icon: CircleDot },
      { title: "Positions", url: "/positions", icon: Activity },
      { title: "Signals", url: "/signals", icon: Radar },
      { title: "Trades", url: "/trades", icon: Receipt },
    ],
  },
  {
    label: "Research",
    items: [
      { title: "Performance", url: "/performance", icon: BarChart3 },
      { title: "Backtests", url: "/backtests", icon: FlaskConical },
      { title: "Strategies", url: "/strategies", icon: GitBranch },
      { title: "Knowledge", url: "/knowledge", icon: BookOpen },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { title: "News", url: "/news", icon: Newspaper },
      { title: "Learn", url: "/learn", icon: GraduationCap },
    ],
  },
  {
    label: "System",
    items: [{ title: "System", url: "/system", icon: Activity }],
  },
];

export function AppSidebar({ role }: { role: "owner" | "guest" }) {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="group-data-[collapsible=icon]:hidden">
          <BrandLockup />
        </div>
        <div className="hidden group-data-[collapsible=icon]:block">
          <BrandLockup collapsed />
        </div>
      </SidebarHeader>
      <SidebarContent className="pt-1">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
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
        ))}
      </SidebarContent>
      {role === "owner" ? (
        <SidebarFooter>
          <SidebarGroupLabel className="px-2">Owner controls</SidebarGroupLabel>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href="/settings/risk" />}
                isActive={pathname.startsWith("/settings/risk")}
                tooltip="Risk"
              >
                <ShieldCheck />
                <span>Risk</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href="/settings/connections" />}
                isActive={pathname.startsWith("/settings/connections")}
                tooltip="Connections"
              >
                <Settings />
                <span>Connections</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href="/settings/access" />}
                isActive={pathname.startsWith("/settings/access")}
                tooltip="Access"
              >
                <Users />
                <span>Access</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      ) : null}
    </Sidebar>
  );
}
