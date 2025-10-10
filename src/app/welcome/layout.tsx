// src/app/welcome/layout.tsx
import Topbar from "@/components/Topbar";

export default function WelcomeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Light sticky bar just for /welcome */}
      <div className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-gray-200">
        <Topbar />
      </div>

      {/* Page content */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 pt-6">
        {children}
      </div>
    </div>
  );
}
