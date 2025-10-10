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

async function generateChapterAndDownload(passionId: string, week: number, title: string) {
  const url = `/api/passions/${encodeURIComponent(passionId)}/weeks/${week}/chapter?debug=1`;

  console.log("🧭 Chapter request URL:", new URL(url, window.location.origin).toString());
  console.log("📦 Params:", { passionId, week, title });

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
    try { json = await res.clone().json(); } catch {}
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
  const m = disp.match(/filename="([^"]+)"/);
  const filename = m?.[1] || `chapter_week${week}.md`;

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

  async function loadWeeks(passionId: string) {
    if (weeks[passionId] || loadingWeeks[passionId]) return;
    setLoadingWeeks((m) => ({ ...m, [passionId]: true }));
    try {
      const r = await fetch(`/api/passions/${encodeURIComponent(passionId)}/weeks`, { cache: "no-store" });
      const j = await r.json();
      setWeeks((m) => ({ ...m, [passionId]: Array.isArray(j?.weeks) ? (j.weeks as WeekRow[]) : [] }));
    } catch (e) {
      console.error("load weeks failed:", e);
      setWeeks((m) => ({ ...m, [passionId]: [] }));
    } finally {
      setLoadingWeeks((m) => ({ ...m, [passionId]: false }));
    }
  }

  async function toggle(passionId: string) {
    setOpenId((v) => (v === passionId ? null : passionId));
    if (!weeks[passionId]) await loadWeeks(passionId);
  }

  async function handleWeekClick(passionId: string, w: WeekRow) {
    const tag = `${passionId}:${w.week}`;
    setBusyWeek(tag);
    setClickMsg(`Generating chapter for ${passionId} / Week ${w.week}…`);
    try {
      await generateChapterAndDownload(passionId, w.week, w.title);
      setClickMsg(`Downloaded: ${passionId} / Week ${w.week}`);
    } catch (e: any) {
      console.error(e);
      setClickMsg(`Failed: ${passionId} / Week ${w.week} — ${e?.message || e}`);
      alert(`Failed to generate chapter: ${e?.message || e}`);
    } finally {
      setBusyWeek((v) => (v === tag ? null : v));
      setTimeout(() => setClickMsg(""), 4000);
    }
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
      {clickMsg && (
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

          const chapterHref =
            p.bucket && p.s3?.chapterKey
              ? `https://s3.console.aws.amazon.com/s3/object/${encodeURIComponent(p.bucket)}?prefix=${encodeURIComponent(p.s3.chapterKey!)}`
              : null;

          const curriculumHref =
            p.bucket && p.s3?.curriculumKey
              ? `https://s3.console.aws.amazon.com/s3/object/${encodeURIComponent(p.bucket)}?prefix=${encodeURIComponent(p.s3.curriculumKey!)}`
              : null;

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
                  <div className="font-medium text-gray-900 truncate">{p.label}</div>
                  <span className="ml-2 text-xs text-gray-500">{isOpen ? "▲" : "▼"}</span>
                </button>

                <div className="flex items-center gap-2">
                  {chapterHref && (
                    <a
                      className="text-xs rounded-md border px-2 py-1 hover:bg-gray-50"
                      target="_blank"
                      rel="noreferrer"
                      href={chapterHref}
                    >
                      Chapter
                    </a>
                  )}
                  {curriculumHref && (
                    <a
                      className="text-xs rounded-md border px-2 py-1 hover:bg-gray-50"
                      target="_blank"
                      rel="noreferrer"
                      href={curriculumHref}
                    >
                      Curriculum
                    </a>
                  )}
                </div>
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
