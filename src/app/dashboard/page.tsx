// src/app/dashboard/page.tsx
"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import PassionsPanel from "@/components/PassionsPanel";
import Image from "next/image";
import Topbar from "@/components/Topbar";

// Rows returned by /api/passions used by PassionsPanel
type UIPassion = {
  id: string;
  label: string;
  status?: "ready" | "pending" | string;
  bucket?: string | null;
  s3?: {
    curriculumKey?: string | null;
    chapterKey?: string | null;
    mergedKey?: string | null;
  } | any;
};

/* ---------- SlideOver Portal (kept if you use elsewhere) ---------- */
function SlideOver({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !open) return null;

  return createPortal(
    <div
      onClick={onClose}
      aria-modal
      role="dialog"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          height: "100%",
          width: "100%",
          maxWidth: "40rem",
          background: "white",
          color: "#111827",
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)",
          padding: "1rem",
          overflow: "auto",
        }}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}

export default function DashboardPage() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [passions, setPassions] = useState<UIPassion[]>([]);
  const [loadingPassions, setLoadingPassions] = useState(true);

  async function loadPassions() {
    try {
      const res = await fetch("/api/passions", { cache: "no-store" });
      const data = await res.json();
      const rows =
        (Array.isArray(data?.passions) && data.passions) ||
        (Array.isArray(data?.items) && data.items) ||
        [];
      setPassions(rows as UIPassion[]);
    } catch (e) {
      console.error("Failed to load passions:", e);
      setPassions([]);
    } finally {
      setLoadingPassions(false);
    }
  }

  useEffect(() => {
    loadPassions();
    const onRefresh = () => loadPassions();
    const onOpen = () => setPanelOpen(true);
    window.addEventListener("aos:refresh", onRefresh);
    window.addEventListener("aos:openPassions", onOpen);
    (window as any).__aos_open = () => setPanelOpen(true);
    (window as any).__aos_close = () => setPanelOpen(false);
    return () => {
      window.removeEventListener("aos:refresh", onRefresh);
      window.removeEventListener("aos:openPassions", onOpen);
    };
  }, []);

  // ----- form state -----
  const [loading, setLoading] = useState(false);
  const [ageRange, setAgeRange] = useState("");
  const [subject, setSubject] = useState("");
  const [passion, setPassion] = useState("");
  const [notes, setNotes] = useState("");
  const [loves, setLoves] = useState("");

  // success modal
  const [successId, setSuccessId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    setSuccessId(null);

    try {
      const passionLikes = loves.split(/\n|,/).map((s) => s.trim()).filter(Boolean);
      const payload = {
        subject: subject.trim(),
        passion: passion.trim(),
        ageRange: ageRange.trim(),
        notes: notes.trim(),
        passionLikes,
      };

      const res = await fetch("/api/generate?debug=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) throw new Error("You must be signed in.");
      if (!res.ok) throw new Error(`Server error ${res.status}: ${await res.text()}`);

      const data = await res.json();
      // ✅ stay on page; refresh data; show success popup
      await loadPassions();
      if (data?.passionId) {
        setSuccessId(String(data.passionId));
      } else {
        setSuccessId("ready");
      }
    } catch (err: any) {
      console.error("generate failed:", err);
      setErrorMsg(err?.message || "Failed to generate.");
    } finally {
      setLoading(false);
    }
  }

  const label = "block font-bold text-white mb-2 tracking-tight";
  const field = [
    "w-full",
    "h-12",
    "rounded-2xl",
    "border border-white/20",
    "bg-white text-gray-900",
    "text-lg",
    "px-0.5 py-0.5",
    "placeholder-gray-500",
    "outline-none",
    "focus:ring-2 focus:ring-emerald-400 focus:border-white",
    "appearance-none",
  ].join(" ");

  return (
  <div className="h-screen grid grid-rows-[auto,1fr,auto] bg-black text-white">
    {/* Header: reuse Topbar, add right-aligned CTA */}
    <div className="relative topbar-compact">
      <Topbar />
      <button
        type="button"
        onClick={() => setPanelOpen(true)}
        className="absolute right-4 top-1/2 -translate-y-1/2 z-50 w-[220px] select-none rounded-2xl bg-emerald-500 px-6 py-3 text-white font-semibold shadow-lg shadow-emerald-900/20 ring-1 ring-emerald-400/20 hover:bg-emerald-400 active:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-400 transition"
      >
        My Mini-Chapters
      </button>
    </div>


    {/* Main (inline form) */}
    <main className="overflow-auto">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <section className="px-[96px]">
          <div className="rounded-3xl border border-white/10 bg-[#222833] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.8)] py-8 px-6 sm:px-8">
            <div className="max-w-3xl mx-auto w-full">
              <form id="aiccsForm" className="space-y-6" onSubmit={handleSubmit}>
                <div className="md:w-1/3">
                  <label className={label}>Age range *</label>
                  <select
                    className={field}
                    value={ageRange}
                    onChange={(e) => setAgeRange(e.target.value)}
                    required
                  >
                    <option value="" disabled>
                      Select age range
                    </option>
                    <option>Grades 3–5</option>
                    <option>Grades 6–8</option>
                    <option>Grades 9–12</option>
                    <option>College / Adult</option>
                  </select>
                </div>

                <div>
                  <label className={label}>Subject / topic *</label>
                  <input
                    className={field}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Algebra I, U.S. History, Biology…"
                    required
                  />
                </div>

                <div>
                  <label className={label}>Passion *</label>
                  <input
                    className={field}
                    value={passion}
                    onChange={(e) => setPassion(e.target.value)}
                    placeholder="Football, anime, nails, cooking, Roblox…"
                    required
                  />
                </div>

                {/* <div>
                  <label className={label}>Notes (optional)</label>
                  <textarea
                    rows={3}
                    className={field + " resize-none"}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any constraints, reading level, IEP considerations, etc."
                  />
                </div> */}

                <div>
                  <label className={label}>List 5–10 things that you love most about the passion you listed above*</label>
                  <textarea
                    rows={4}
                    className={field + " resize-none"}
                    value={loves}
                    onChange={(e) => setLoves(e.target.value)}
                    placeholder="speed, teamwork, strategy, defense… (comma or newline separated)"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={loading}
                    className="mx-auto block w-[220px] select-none rounded-2xl bg-emerald-500 px-6 py-3 text-white font-semibold shadow-lg shadow-emerald-900/20 ring-1 ring-emerald-400/20 hover:bg-emerald-600 active:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-400 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loading ? "Generating…" : "Enter / Generate"}
                  </button>
                </div>

                {errorMsg && (
                  <p className="pt-2 text-center text-sm text-red-300">{errorMsg}</p>
                )}
              </form>
            </div>
          </div>
        </section>
      </div>
    </main>

    {/* PassionsPanel slideout */}
    {panelOpen &&
      (loadingPassions ? (
        <PassionsPanel
          passions={[]}
          onRefresh={loadPassions}
          mode="standalone"
          title="Mini-Chapters"
          defaultOpen
          onClose={() => setPanelOpen(false)}
        />
      ) : (
        <PassionsPanel
          passions={passions}
          onRefresh={loadPassions}
          mode="standalone"
          title="Mini-Chapters"
          defaultOpen
          onClose={() => setPanelOpen(false)}
        />
      ))}

    {/* === Processing overlay with GIF === */}
    {loading && (
      <div className="fixed inset-0 z-[9999] grid place-items-center bg-black/60 backdrop-blur-sm">
        <div className="rounded-2xl bg-[#0f1216] p-6 shadow-xl border border-white/10 text-center">
          <img src="/processing.gif" alt="Processing…" className="mx-auto h-24 w-24" />
          <h3 className="mt-4 text-white text-lg font-medium">Building your readings…</h3>
          <p className="mt-1 text-sm text-gray-400">
            This usually takes a moment. You can stay on this page.
          </p>
        </div>
      </div>
    )}

    {/* === Success modal === */}
    {successId && (
      <div className="fixed inset-0 z-[9999] grid place-items-center bg-black/60 backdrop-blur-sm">
        <div className="w-[min(92vw,520px)] rounded-2xl bg-white p-6 shadow-xl">
          <h3 className="text-xl font-semibold text-gray-900">Your readings are ready!</h3>
          <p className="mt-2 text-gray-600">
            Click <span className="font-medium">My Mini-Chapters</span> at the top to access them.
          </p>

          <div className="mt-5 flex gap-3">
            <button
              onClick={() => {
                setPanelOpen(true);
                setSuccessId(null);
              }}
              className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-white shadow hover:shadow-md"
            >
              Open My Mini-Chapters
            </button>
            <button
              onClick={() => setSuccessId(null)}
              className="rounded-lg border border-gray-300 px-4 py-2 text-gray-800 hover:bg-gray-50"
            >
              Close
            </button>
          </div>

          {successId !== "ready" && (
            <p className="mt-3 text-xs text-gray-500">(Passion ID: {successId})</p>
          )}
        </div>
      </div>
    )}

    {/* Page-scoped tweak: make Topbar slimmer only on this page */}
    <style jsx global>{`
      .topbar-compact > div {
        padding: 0.5rem !important; /* slimmer than p-3 */
        min-height: 48px;
      }
      .topbar-compact img[alt="AOS Logo"] {
        width: 28px !important;
        height: 28px !important;
      }
      .topbar-compact .w-8.h-8 {
        width: 28px !important;
        height: 28px !important;
      }
    `}</style>
  </div>
);
}
