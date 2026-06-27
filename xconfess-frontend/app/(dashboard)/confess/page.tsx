"use client";

import { EnhancedConfessionForm } from "@/app/components/confession/EnhancedConfessionForm";

export default function ConfessPage() {
  return (
    <div className="container mx-auto py-6 max-w-2xl px-4">
      <h1 className="text-3xl font-bold mb-6 font-editorial text-[var(--foreground)]">
        New Confession
      </h1>
      <div className="luxury-panel rounded-[34px] p-6">
        <EnhancedConfessionForm className="w-full" />
      </div>
    </div>
  );
}
