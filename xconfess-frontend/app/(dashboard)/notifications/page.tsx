"use client";

import { NotificationCenter } from "@/app/components/notifications/NotificationCenter";

export default function NotificationsPage() {
  return (
    <div className="container mx-auto py-6 max-w-2xl px-4">
      <h1 className="text-3xl font-bold mb-6 font-editorial text-[var(--foreground)]">
        Notifications
      </h1>
      <div className="w-full">
        <NotificationCenter className="w-full max-w-full md:w-full md:max-w-full" />
      </div>
    </div>
  );
}
