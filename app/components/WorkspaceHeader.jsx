"use client";

import Link from "next/link";
import NotificationBell from "./notifications/NotificationBell";
import { useEffect, useState } from "react";
import {
  ChevronDown, Globe, LayoutDashboard, LogOut, Mail, Menu,
  MessageSquare, Moon, Settings, Sun, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/low-ctr", label: "Improve a page", Icon: Globe },
  { href: "/generic-keywords", label: "New page ideas", Icon: TrendingUp },
  { href: "/chatbot", label: "SEO Mentor", Icon: MessageSquare },
];

function websiteLabel(value) {
  if (!value) return "No website set";
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")}`;
  } catch { return value; }
}

export default function WorkspaceHeader({ pathname, businessName, websiteUrl, isDarkMode, toggleTheme, onLogout, isAdmin = false }) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  useEffect(() => {
    setNavigationOpen(false);
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setNavigationOpen(false); };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [pathname]);
  const name = businessName || "Your account";
  const initial = Array.from(name.trim())[0]?.toUpperCase() || "A";
  const active = href => pathname === href;
  const logout = async () => {
    setLoggingOut(true);
    setLogoutError("");
    try { await onLogout(); }
    catch { setLogoutError("We couldn’t log you out. Open Account and try again."); }
    finally { setLoggingOut(false); }
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="container mx-auto flex h-[76px] items-center justify-between gap-1 px-3 sm:gap-3 sm:px-6">
        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu open={navigationOpen} onOpenChange={setNavigationOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation menu" className="size-9 lg:hidden">
                <Menu aria-hidden="true" className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={12} className="z-[70] w-64 max-w-[calc(100vw-2rem)] rounded-xl p-2 lg:hidden">
              <DropdownMenuLabel className="px-3 text-xs font-normal text-muted-foreground">Your workspace</DropdownMenuLabel>
              {navigation.map(({ href, label, Icon }) => (
                <DropdownMenuItem key={href} asChild className={cn("min-h-11 rounded-lg px-3", active(href) && "bg-primary/10 text-primary")}>
                  <Link href={href} aria-current={active(href) ? "page" : undefined}>
                    <Icon aria-hidden="true" className={cn("size-4", active(href) && "text-primary")} />
                    {label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Link href="/dashboard" aria-label="SimplSEO dashboard" className="flex h-12 w-[clamp(100px,calc(100vw-224px),184px)] shrink-0 items-center overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-[160px]">
            <img src={isDarkMode ? "/dark.png" : "/light.png"} alt="SimplSEO" className="block h-auto w-full scale-[1.35]" />
          </Link>
        </div>

        <nav aria-label="Main navigation" className="hidden items-center gap-1 lg:flex">
          {navigation.map(({ href, label, Icon }) => (
            <Button key={href} asChild variant="ghost" className={cn("h-10 gap-2 px-3", active(href) && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary")}>
              <Link href={href} aria-current={active(href) ? "page" : undefined}>
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </Link>
            </Button>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <NotificationBell />
        <DropdownMenu key={`account-${pathname}`}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" aria-label="Account" disabled={loggingOut} className="h-11 shrink-0 gap-1 rounded-full px-2 sm:gap-2 sm:pl-2 sm:pr-3">
              <span aria-hidden="true" className="hidden size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary sm:flex">{initial}</span>
              <span>{loggingOut ? "Logging out…" : "Account"}</span>
              <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={12} collisionPadding={16} className="z-[70] w-72 max-w-[calc(100vw-2rem)] rounded-xl p-2">
            <DropdownMenuLabel className="space-y-1 px-3 py-3">
              <p className="break-words text-sm font-semibold">{name}</p>
              <p className="break-all text-xs font-normal text-muted-foreground">{websiteLabel(websiteUrl)}</p>
            </DropdownMenuLabel>
            {isAdmin && <DropdownMenuItem asChild><Link href="/admin/access-requests"><Mail aria-hidden="true" className="size-4" />Early-access invitations</Link></DropdownMenuItem>}
              <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="min-h-11 rounded-lg px-3">
              <Link href="/settings" aria-current={active("/settings") ? "page" : undefined}><Settings aria-hidden="true" />Settings</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="min-h-11 rounded-lg px-3">
              <Link href="/contact" aria-current={active("/contact") ? "page" : undefined}><Mail aria-hidden="true" />Help &amp; contact</Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={toggleTheme} className="min-h-11 rounded-lg px-3">
              {isDarkMode ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
              {isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={logout} disabled={loggingOut} className="min-h-11 rounded-lg px-3">
              <LogOut aria-hidden="true" />Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>
      {logoutError && <p role="alert" className="container mx-auto px-4 pb-3 text-sm text-destructive">{logoutError}</p>}
    </header>
  );
}
