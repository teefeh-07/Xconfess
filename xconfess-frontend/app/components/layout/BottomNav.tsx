"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, PlusCircle, Bell, User } from "lucide-react";
import { useNotifications } from "@/app/lib/hooks/useNotifications";
import { useAuth } from "@/app/lib/hooks/useAuth";

export default function BottomNav() {
  const pathname = usePathname();
  const { user } = useAuth();
  const userId = user?.id || "";
  const { unreadCount } = useNotifications(userId);

  const navItems = [
    { href: "/", icon: Home, label: "Home" },
    { href: "/search", icon: Search, label: "Search" },
    { href: "/confess", icon: PlusCircle, label: "New" },
    { href: "/notifications", icon: Bell, label: "Notifications", badge: unreadCount },
    { href: "/profile", icon: User, label: "Profile" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 md:hidden border-t border-[var(--border)] bg-[color:rgba(243,239,232,0.85)] dark:bg-[color:rgba(18,24,33,0.85)] backdrop-blur-xl pb-[calc(env(safe-area-inset-bottom)+0.25rem)] pt-2 shadow-[0_-4px_24px_rgba(0,0,0,0.04)]">
      <div className="flex justify-around items-center max-w-md mx-auto px-4">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex flex-col items-center gap-1 p-2 rounded-xl transition-all duration-200 ${
                isActive
                  ? "text-violet-600 dark:text-violet-400 scale-105"
                  : "text-[var(--secondary)] hover:text-[var(--foreground)]"
              }`}
            >
              <Icon size={20} className={isActive ? "stroke-[2.5]" : "stroke-[2]"} />
              <span className="text-[10px] font-semibold tracking-wide uppercase">
                {item.label}
              </span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white ring-2 ring-white dark:ring-zinc-900">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
