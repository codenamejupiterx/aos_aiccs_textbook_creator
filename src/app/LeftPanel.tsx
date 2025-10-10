// src/app/LeftPanel.tsx
"use client";

import { usePathname } from "next/navigation";
import GenerateForm from "@/components/GenerateForm";

export default function LeftPanel() {
  const pathname = usePathname();

  if (!pathname?.startsWith("/dashboard")) return null;

  return (
    <div className="panel-body">
      <div className="aos-card rounded-2xl p-4 h-full">
        <h2 className="aos-title text-xl font-semibold mb-4">Create new plan</h2>
        <GenerateForm onDone={() => window.dispatchEvent(new CustomEvent("aos:refresh"))} />
      </div>
    </div>
  );
}
