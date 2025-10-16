/* eslint-disable */
"use client";

import { useState } from "react";
import styles from "./Slideout.module.css";

/** Keep original shapes so existing callers still work */
type Row = {
  id: string;
  label: string;
  status?: "pending" | "ready" | string;
  bucket?: string | null;
  s3?: {
    curriculumKey?: string | null;
    chapterKey?: string | null;
    mergedKey?: string | null;
  };
};

type WeekRow = { week: number; title: string };

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- accepts format and passes it to API
async function generateChapterAndDownload(
  passionId: string,
  week: number,
  title: string,
  format: "pdf" | "docx" = "pdf"
) {
  const url = `/api/passions/${encodeURIComponent(
    passionId
  )}/weeks/${week}/chapter?debug=1&format=${format}`;

  console.log("🧭 Chapter request URL:", new URL(url, window.location.origin).toString());
  console.log("📦 Params:", { passionId, week, title, format });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

  console.log("📡 Response:", { status: res.status, ok: res.ok, finalUrl: res.url });

  // Peek at JSON safely (even on errors)
  let json: any = null;
  const isJSON = (res.headers.get("content-type") || "").includes("application/json");
  if (isJSON) {
    try {
      json = await res.clone().json();
    } catch {}
  }
  if (json) console.log("🔎 JSON body (debug):", json);

  if (!res.ok) {
    const msg = json?.error || `HTTP ${res.status}`;
    console.error("❌ Chapter gen failed:", msg, json);
    throw new Error(msg);
  }

  // Success → use server-sent filename if present
  const blob = await res.blob();
  const disp = res.headers.get("Content-Disposition") || "";
  const m = /filename="([^"]+)"/i.exec(disp);
  const filename = m?.[1] || `chapter_week${week}.${format}`;

  downloadBlob(blob, filename);
}

export default function PassionsPanel({
  passions,
  onRefresh,
  title = "Mini-Chapters",
  /** standalone = renders overlay+panel; embedded = content-only */
  mode = "standalone",
  defaultOpen = true,
  onClose,
  showHeader, // optional override
}: {
  passions: Row[];
  onRefresh: () => void;
  title?: string;
  mode?: "standalone" | "embedded";
  defaultOpen?: boolean;
  onClose?: () => void;
  showHeader?: boolean;
}) {
  // slideout open/close (used only in standalone mode)
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  // your existing local state
  const [openId, setOpenId] = useState<string | null>(null);
  const [weeks, setWeeks] = useState<Record<string, WeekRow[]>>({});
  const [loadingWeeks, setLoadingWeeks] = useState<Record<string, boolean>>({});
  const [clickMsg, setClickMsg] = useState<string>("");
  const [busyWeek, setBusyWeek] = useState<string | null>(null); // `${passionId}:${week}` while generating

  // format chooser modal state (+ busy flag to show progress inside modal)
  const [chooser, setChooser] = useState<{
    open: boolean;
    passionId?: string;
    week?: number;
    title?: string;
    format: "pdf" | "docx";
    busy?: boolean;
  }>({ open: false, format: "pdf", busy: false });

async function loadWeeks(passionId: string, force = false) {
  if (!force && (weeks[passionId] || loadingWeeks[passionId])) return;

  setLoadingWeeks(m => ({ ...m, [passionId]: true }));
  try {
    const r = await fetch(
      `/api/passions/${encodeURIComponent(passionId)}/weeks`,
      { cache: "no-store" }
    );
    const j = await r.json();
    setWeeks(m => ({
      ...m,
      [passionId]: Array.isArray(j?.weeks) ? (j.weeks as WeekRow[]) : [],
    }));
  } catch (e) {
    console.error("load weeks failed:", e);
    setWeeks(m => ({ ...m, [passionId]: [] }));
  } finally {
    setLoadingWeeks(m => ({ ...m, [passionId]: false }));
  }
}


 async function toggle(passionId: string) {
  // compute next state first (setState is async)
  const next = openId === passionId ? null : passionId;
  setOpenId(next);

  // if we're opening this passion now, force a fresh fetch
  if (next === passionId) {
    await loadWeeks(passionId, true);
  }
}


  // open chooser instead of immediate download
  async function handleWeekClick(passionId: string, w: WeekRow) {
    setChooser({ open: true, passionId, week: w.week, title: w.title, format: "pdf", busy: false });
    setClickMsg(""); // hide background toast while modal is up
  }

  // confirm from modal → generate with chosen format (show status inside modal)
  async function confirmGenerate() {
    if (!chooser.passionId || !chooser.week || !chooser.title) return;
    setChooser((c) => ({ ...c, busy: true })); // show “Generating…” in modal

    const tag = `${chooser.passionId}:${chooser.week}`;
    setBusyWeek(tag);

    try {
      await generateChapterAndDownload(chooser.passionId, chooser.week, chooser.title, chooser.format);
    } catch (e: any) {
      console.error(e);
      alert(`Failed to generate: ${e?.message || e}`);
    } finally {
      setChooser((c) => ({ ...c, open: false, busy: false }));
      setBusyWeek((v) => (v === tag ? null : v));
    }
  }

  function closeChooser() {
    if (chooser.busy) return; // prevent closing while generating
    setChooser((c) => ({ ...c, open: false }));
  }

  // ----- Render the inner content (used by both modes) -----
  const Header = (props: { embedded: boolean }) => {
    const shouldShowHeader = showHeader ?? (mode === "standalone");
    if (!shouldShowHeader) return null;
    return (
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {mode === "standalone" && (
          <button className={styles.closeBtn} onClick={handleClose}>Close</button>
        )}
      </header>
    );
  };

  const Content = () => (
    <div className={styles.body}>
      {/* only show the background banner when modal is not open */}
      {!chooser.open && clickMsg && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1 mb-2">
          {clickMsg}
        </div>
      )}

      {!passions?.length ? (
        <p className="text-gray-700">No plans yet. Create one on the left.</p>
      ) : (
        passions.map((p) => {
          const isOpen = openId === p.id;
          const wks = weeks[p.id];
          const isLoading = !!loadingWeeks[p.id];

          return (
            <div key={p.id} className={styles.group}>
              {/* Header row (click to expand) */}
              <div className="flex items-center justify-between px-3 py-2">
                <button
                  onClick={() => toggle(p.id)}
                  className="flex items-center gap-2 min-w-0"
                  aria-expanded={isOpen}
                  aria-controls={`weeks-${p.id}`}
                  title="Expand weeks"
                >
                  <span
                    className={
                      "inline-block h-2.5 w-2.5 rounded-full " +
                      (p.status === "ready" ? "bg-emerald-500" : "bg-amber-400")
                    }
                    title={p.status}
                  />
                  {/* readability tweak */}
                  <div className="font-medium text-white truncate">{p.label}</div>
                  <span className="ml-2 text-xs text-gray-500">{isOpen ? "▲" : "▼"}</span>
                </button>
              </div>

              {/* Expandable weeks list */}
              {isOpen && (
                <div id={`weeks-${p.id}`} className="border-t border-gray-200">
                  {isLoading ? (
                    <div className="px-3 py-2 text-sm text-gray-500">Loading weeks…</div>
                  ) : !wks ? (
                    <div className="px-3 py-2 text-sm text-gray-500">Loading weeks…</div>
                  ) : wks.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500">No weeks found.</div>
                  ) : (
                    <ul>
                      {wks.map((w) => {
                        const tag = `${p.id}:${w.week}`;
                        const spinning = busyWeek === tag;
                        return (
                          <li key={w.week} className={styles.weekRow}>
                            <div className={styles.weekTitle}>
                              Week {w.week}
                              <span className={styles.weekSubtle}>: {w.title}</span>
                            </div>
                            <button
                              onClick={() => handleWeekClick(p.id, w)}
                              className={styles.genBtn}
                              disabled={spinning}
                              aria-disabled={spinning}
                              title={spinning ? "Generating…" : "Generate & Download"}
                            >
                              {spinning ? "Generating…" : "Generate & Download"}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* Optional toolbar */}
      <div className="pt-3">
        <button
          onClick={onRefresh}
          className="text-xs px-2 py-1 rounded-md border border-gray-300 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {/* === Format chooser modal === */}
      {chooser.open && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/40"
            onClick={closeChooser}
            aria-hidden
          />
          <div
            className="fixed z-[61] inset-0 grid place-items-center p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="w-full max-w-md rounded-2xl bg-slate-900 text-slate-100 shadow-2xl ring-1 ring-white/10">
              <div className="px-5 py-4 border-b border-white/10">
                <h3 className="text-lg font-semibold">Pick your format</h3>
                <p className="mt-1 text-sm text-slate-300">
                  Choose a file type for Week {chooser.week}.
                </p>

                {chooser.busy && (
                  <div className="mt-3 flex items-center gap-2 text-xs text-emerald-200 bg-emerald-900/30 border border-emerald-700/50 rounded-md px-2 py-1">
                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" aria-hidden>
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4A4 4 0 0 0 8 12H4z" />
                    </svg>
                    <span>Generating ({chooser.format.toUpperCase()}) for Week {chooser.week}…</span>
                  </div>
                )}
              </div>

              <div className="px-5 py-4 space-y-3">
                <label className={`flex items-center gap-3 ${chooser.busy ? "opacity-50 pointer-events-none" : ""}`}>
                  <input
                    type="radio"
                    name="fmt"
                    value="pdf"
                    checked={chooser.format === "pdf"}
                    onChange={() => setChooser((c) => ({ ...c, format: "pdf" }))}
                    className="h-4 w-4"
                  />
                  <span>.pdf (ready to share/print)</span>
                </label>

                <label className={`flex items-center gap-3 ${chooser.busy ? "opacity-50 pointer-events-none" : ""}`}>
                  <input
                    type="radio"
                    name="fmt"
                    value="docx"
                    checked={chooser.format === "docx"}
                    onChange={() => setChooser((c) => ({ ...c, format: "docx" }))}
                    className="h-4 w-4"
                  />
                  <span>.docx (editable in Word/Docs)</span>
                </label>
              </div>

              <div className="px-5 py-4 flex items-center justify-end gap-2 border-t border-white/10">
                <button
                  onClick={closeChooser}
                  disabled={!!chooser.busy}
                  className={`px-3 py-1.5 rounded-lg border border-white/20 ${chooser.busy ? "opacity-50" : "hover:bg-white/5"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmGenerate}
                  disabled={!!chooser.busy}
                  className={`px-3 py-1.5 rounded-lg bg-indigo-500 text-white ${chooser.busy ? "opacity-60" : "hover:bg-indigo-600"}`}
                >
                  {chooser.busy ? "Generating…" : "Download"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  // ----- Standalone vs Embedded wrappers -----
  if (mode === "embedded") {
    // No overlay/panel; just the content (you can place this inside your existing slideout)
    return (
      <>
        <Header embedded />
        <Content />
      </>
    );
  }

  // Standalone: render overlay + panel
  return (
    <>
      <div
        className={styles.overlay}
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
        onClick={handleClose}
      />
      <aside
        className={styles.panel}
        style={{ transform: open ? "translateX(0)" : "translateX(100%)" }}
      >
        <Header embedded={false} />
        <Content />
      </aside>
    </>
  );
}
