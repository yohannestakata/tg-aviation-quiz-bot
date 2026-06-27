"use client"

import Link from "next/link"
import {
  BarChart3Icon,
  BookOpenIcon,
  FolderIcon,
  LogOutIcon,
  PlaneIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { clearToken } from "@/lib/api"

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  activeView: "overview" | "categories" | "questions"
  onViewChange: (view: "overview" | "categories" | "questions") => void
}

const items = [
  { id: "overview" as const, label: "Overview", icon: BarChart3Icon },
  { id: "categories" as const, label: "Categories", icon: FolderIcon },
  { id: "questions" as const, label: "Questions", icon: BookOpenIcon },
]

export function AppSidebar({
  activeView,
  onViewChange,
  ...props
}: AppSidebarProps) {
  function logout() {
    clearToken()
    window.location.href = "/login"
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/dashboard">
                <PlaneIcon />
                <span className="font-semibold">Aviation Quiz</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = item.icon
            return (
              <SidebarMenuItem key={item.id}>
                <SidebarMenuButton
                  isActive={activeView === item.id}
                  onClick={() => onViewChange(item.id)}
                >
                  <Icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        <Button variant="outline" className="w-full justify-start" onClick={logout}>
          <LogOutIcon />
          Logout
        </Button>
      </SidebarFooter>
    </Sidebar>
  )
}
