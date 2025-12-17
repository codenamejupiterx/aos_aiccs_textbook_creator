/* eslint-disable */
"use client";

import { useState, useEffect, useRef } from "react";
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

function safeSlug(input: string) {
  return (input || "")
    .trim()
    .replace(/\s+/g, "_")           // spaces -> _
    .replace(/[^\w\-]+/g, "")       // remove weird chars
    .replace(/_+/g, "_")            // collapse ___
    .replace(/^_+|_+$/g, "");       // trim leading/trailing _
}

function buildChapterFilename(week: number, title: string, format: "pdf" | "docx") {
  const slug = safeSlug(title) || "chapter";
  return `chapter_${week}_${slug}.${format}`;
}

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

// helper: enqueue job + poll until done, then return URL and filename
async function generateChapterAndDownload(
  passionId: string,
  week: number,
  title: string,
  format: "pdf" | "docx" = "pdf",
  onProgress?: (msg: string) => void
): Promise<{ downloadUrl: string; filename: string }> {
  const enqueueUrl = `/api/passions/${encodeURIComponent(
    passionId
  )}/weeks/${week}/chapter?debug=1&format=${format}`;

  // small helper so we don't spam the same message repeatedly
  let lastMsg = "";
  const say = (msg: string) => {
    if (!onProgress) return;
    if (msg === lastMsg) return;
    lastMsg = msg;
    onProgress(msg);
  };

  console.log(
    "🧭 Chapter enqueue URL:",
    new URL(enqueueUrl, window.location.origin).toString()
  );
  console.log("📦 Params:", { passionId, week, title, format });

  // 1) ENQUEUE
  say("Queued…");

  const res = await fetch(enqueueUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

  const json: any = await res.json().catch(() => null);

  if (!res.ok || !json?.ok) {
    const msg = json?.error || `HTTP ${res.status}`;
    console.error("❌ Chapter enqueue failed:", msg, json);
    say("Failed to queue the job.");
    throw new Error(msg);
  }

  const jobId: string | undefined = json.jobId;
  if (!jobId) {
    console.error("❌ Chapter enqueue response missing jobId:", json);
    say("Queue error (missing job id).");
    throw new Error("Chapter job could not be queued (no jobId).");
  }

  console.log("📨 Chapter job queued:", jobId);
  say("Generating your chapter…");

  // 2) POLL STATUS
  const statusUrl = `/api/chapter-jobs/${encodeURIComponent(jobId)}/status`;
  const maxAttempts = 60; // 60 * 5s = 5 minutes
  const delayMs = 5000;

  let lastStatus = "pending";

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // ✅ show “still alive” progress
    // - every attempt shows attempt count
    // - extra friendly milestones at specific attempts
    say(`Working… (${attempt + 1}/${maxAttempts})`);

    if (attempt === 6) say("Still working… this can take a minute or two.");
    if (attempt === 18) say("Almost there… finishing up the file.");

    const sRes = await fetch(statusUrl, { cache: "no-store" });
    const sJson: any = await sRes.json().catch(() => null);

    if (!sRes.ok || !sJson?.ok) {
      const msg = sJson?.error || `status HTTP ${sRes.status}`;
      console.error("❌ Chapter status check failed:", msg, sJson);
      say("Having trouble checking status…");
      throw new Error(msg);
    }

    lastStatus = (sJson.status as string) || "pending";
    console.log(
      `📊 Chapter job status [${jobId}] attempt ${attempt + 1}/${maxAttempts}:`,
      lastStatus
    );

    // If your worker uses more statuses, these messages will feel nicer.
    if (lastStatus === "pending") say(`Queued… (${attempt + 1}/${maxAttempts})`);
    if (lastStatus === "running")
      say(`Generating… (${attempt + 1}/${maxAttempts})`);

    if (lastStatus === "done") {
      const downloadUrl: string | undefined = sJson.downloadUrl;
      //const filename: string = sJson.filename || `chapter_${jobId}.${format}`;
      const filename: string = buildChapterFilename(week, title, format);

      if (!downloadUrl) {
        say("Finished, but download link is missing.");
        throw new Error("Chapter job finished but no downloadUrl was provided.");
      }

      console.log("✅ Chapter ready, returning download info:", {
        downloadUrl,
        filename,
      });

      say("Ready!");
      return { downloadUrl, filename };
    }

    if (lastStatus === "error") {
      const msg = sJson.error || "Chapter generation failed.";
      console.error("❌ Chapter job error:", msg, sJson);
      say("Generation failed.");
      throw new Error(msg);
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }

  say("Timed out waiting for the chapter to finish.");
  throw new Error(
    `Timed out waiting for chapter job to finish (last status: ${lastStatus}).`
  );
}



// assume Row, WeekRow, generateChapterAndDownload are defined/imported above

export default function PassionsPanel({
  passions,
  onRefresh,
  title = "Mini-Chapters",
  mode = "standalone",
  defaultOpen = true,
  onClose,
  showHeader,
  highlightedId,
}: {
  passions: Row[];
  onRefresh: () => void;
  title?: string;
  mode?: "standalone" | "embedded";
  defaultOpen?: boolean;
  onClose?: () => void;
  showHeader?: boolean;
  highlightedId?: string;
}) {
  // slideout open/close
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  // local state
  const [openId, setOpenId] = useState<string | null>(null);
  const [weeks, setWeeks] = useState<Record<string, WeekRow[]>>({});
  const [loadingWeeks, setLoadingWeeks] = useState<Record<string, boolean>>({});
  const [clickMsg, setClickMsg] = useState<string>("");
  const [busyWeek, setBusyWeek] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>("");

  // 🔹 new: pending download info (url + filename)
  const [pendingDownload, setPendingDownload] = useState<{
    url: string;
    filename: string;
  } | null>(null);

  // format chooser state
  const [chooser, setChooser] = useState<{
    open: boolean;
    passionId?: string;
    week?: number;
    title?: string;
    format: "pdf" | "docx";
    busy?: boolean;
  }>({ open: false, format: "pdf", busy: false });

  /* ========= 1) AUTO-SCROLL to highlighted/open row ========= */
  useEffect(() => {
    if (!openId && !highlightedId) return;

    const container = scrollRef.current;
    if (!container) return;

    // prefer the newly-created one
    const highlightedEl = document.getElementById("aos-new-passion");
    const normalEl = openId
      ? document.getElementById(`passion-row-${openId}`)
      : null;
    const target = highlightedEl || normalEl;
    if (!target) return;

    const t = setTimeout(() => {
      const cRect = container.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      const offset = tRect.top - cRect.top - 8;

      container.scrollTo({
        top: container.scrollTop + offset,
        behavior: "smooth",
      });
    }, 60);

    return () => clearTimeout(t);
  }, [openId, highlightedId]);

  /* ========= 2) fetch weeks — but can restore scroll once it’s done ========= */
  async function loadWeeks(
    passionId: string,
    force = false,
    restoreScroll?: number
  ) {
    if (!force && (weeks[passionId] || loadingWeeks[passionId])) return;

    setLoadingWeeks((m) => ({ ...m, [passionId]: true }));
    try {
      const r = await fetch(
        `/api/passions/${encodeURIComponent(passionId)}/weeks`,
        { cache: "no-store" }
      );
      const j = await r.json();
      setWeeks((m) => ({
        ...m,
        [passionId]: Array.isArray(j?.weeks) ? (j.weeks as WeekRow[]) : [],
      }));
    } catch (e) {
      console.error("load weeks failed:", e);
      setWeeks((m) => ({ ...m, [passionId]: [] }));
    } finally {
      setLoadingWeeks((m) => ({ ...m, [passionId]: false }));

      // 👇 this is the piece that stops the “third jump”
      if (restoreScroll !== undefined && scrollRef.current) {
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = restoreScroll;
          }
        });
      }
    }
  }

  /* ========= 3) toggle row (preserve scroll) ========= */
  function toggle(passionId: string) {
    const container = scrollRef.current;
    const savedScroll = container ? container.scrollTop : 0;

    const next = openId === passionId ? null : passionId;
    setOpenId(next);

    if (next === passionId) {
      // fire-and-forget, but tell it what scroll to restore to
      void loadWeeks(passionId, true, savedScroll);
    }

    // restore immediately so user doesn’t see the first jump
    requestAnimationFrame(() => {
      if (container) {
        container.scrollTop = savedScroll;
      }
    });
  }

  /* ========= 4) week click → open format modal ========= */
  function handleWeekClick(passionId: string, w: WeekRow) {
    setProgressMsg(""); // ✅ clear old progress text from any previous run

    setChooser({
      open: true,
      passionId,
      week: w.week,
      title: w.title,
      format: "pdf",
      busy: false,
    });
    setClickMsg("");
  }

  async function confirmGenerate() {
    setProgressMsg(""); // ✅ clear old progress text from any previous run
    if (!chooser.passionId || !chooser.week || !chooser.title) return;

    setChooser((c) => ({ ...c, busy: true }));
    const tag = `${chooser.passionId}:${chooser.week}`;
    setBusyWeek(tag);

    try {
      setProgressMsg("Queued…"); // ✅ HERE (immediately when user clicks Download)

      const { downloadUrl, filename } = await generateChapterAndDownload(
        chooser.passionId,
        chooser.week,
        chooser.title,
        chooser.format,
        (msg) => setProgressMsg(msg)
      );

      setPendingDownload({ url: downloadUrl, filename });
    } catch (e: any) {
      console.error(e);
      alert(`Failed to generate: ${e?.message || e}`);
    } finally {
      setChooser((c) => ({ ...c, open: false, busy: false }));
      setBusyWeek((v) => (v === tag ? null : v));
    }
  }


  function closeChooser() {
    setProgressMsg(""); // ✅ clear old progress text from any previous run
    if (chooser.busy) return;
    setChooser((c) => ({ ...c, open: false }));
  }

  /* ========= render bits ========= */

  const Header = ({ embedded }: { embedded: boolean }) => {
    const shouldShowHeader = showHeader ?? mode === "standalone";
    if (!shouldShowHeader) return null;
    return (
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {mode === "standalone" && (
          <button className={styles.closeBtn} onClick={handleClose}>
            Close
          </button>
        )}
      </header>
    );
  };

  const Content = () => (
    <div ref={scrollRef} className={styles.body}>
      {!chooser.open && clickMsg && (
        <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-2 py-1 mb-2">
          {clickMsg}
        </div>
      )}

      {/* 🔹 Ready-to-download banner */}
      {pendingDownload && (
        <div className={styles.readyBanner}>
          <div className={styles.readyBannerRow}>
            <span className={styles.readyBannerText}>
              Your chapter is ready:{" "}
              <span className={styles.readyBannerFile}>{pendingDownload.filename}</span>
            </span>

            <button
              onClick={() => {
                const a = document.createElement("a");
                a.href = pendingDownload.url;
                a.download = pendingDownload.filename;
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                document.body.appendChild(a);
                a.click();
                a.remove();
                setPendingDownload(null);
              }}
              className={styles.readyBannerBtn}
            >
              Download
            </button>
          </div>
        </div>
      )}


      {!passions?.length ? (
        <p className="text-gray-700">No plans yet. Create one on the left.</p>
      ) : (
        passions.map((p) => {
          const isOpen = openId === p.id;
          const wks = weeks[p.id];
          const isLoading = !!loadingWeeks[p.id];
          const isHighlighted = highlightedId === p.id;

          return (
            <div
              key={p.id}
              id={isHighlighted ? "aos-new-passion" : `passion-row-${p.id}`}
              className={
                styles.group +
                (isHighlighted ? " ring-2 ring-emerald-400 rounded-lg" : "")
              }
            >
              {/* row header */}
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
                      (p.status === "ready"
                        ? "bg-emerald-500"
                        : "bg-amber-400")
                    }
                    title={p.status}
                  />
                  <div className="font-medium text-white truncate">
                    {p.label}
                  </div>
                  <span className="ml-2 text-xs text-gray-500">
                    {isOpen ? "▲" : "▼"}
                  </span>
                </button>
              </div>

              {/* weeks list */}
              {isOpen && (
                <div id={`weeks-${p.id}`} className="border-t border-gray-200">
                  {isLoading ? (
                    <div className="px-3 py-2 text-sm text-gray-500">
                      Loading weeks…
                    </div>
                  ) : !wks ? (
                    <div className="px-3 py-2 text-sm text-gray-500">
                      Loading weeks…
                    </div>
                  ) : wks.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500">
                      No weeks found.
                    </div>
                  ) : (
                    <ul>
                      {wks.map((w) => {
                        const tag = `${p.id}:${w.week}`;
                        const spinning = busyWeek === tag;
                        return (
                          <li key={w.week} className={styles.weekRow}>
                            <div className={styles.weekTitle}>
                              Week {w.week}
                              <span className={styles.weekSubtle}>
                                : {w.title}
                              </span>
                            </div>
                            <button
                              onClick={() => handleWeekClick(p.id, w)}
                              className={styles.genBtn}
                              disabled={spinning}
                              aria-disabled={spinning}
                              title={
                                spinning
                                  ? "Generating…"
                                  : "Generate & Download"
                              }
                            >
                              {spinning
                                ? "Generating…"
                                : "Generate & Download"}
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

      {/* footer toolbar */}
      <div className="pt-3">
        <button
          onClick={onRefresh}
          className="text-xs px-2 py-1 rounded-md border border-gray-300 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {/* format chooser modal */}
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
                  {chooser.busy
                    ? (progressMsg || `Generating Week ${chooser.week}… hang tight.`)
                    : `Choose a file type for Week ${chooser.week}.`}
                </p>

                {chooser.busy && (
                  <div className="mt-3">
                    <div className="text-xs text-slate-200">
                      {progressMsg || `Generating (${chooser.format.toUpperCase()}) for Week ${chooser.week}…`}
                    </div>

                    <div className={styles.progressBarOuter}>
                      <div className={styles.progressBarInner} />
                    </div>
                  </div>
                )}
              </div>

              <div className="px-5 py-4 space-y-3">
                <label
                  className={`flex items-center gap-3 ${
                    chooser.busy ? "opacity-50 pointer-events-none" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="fmt"
                    value="pdf"
                    checked={chooser.format === "pdf"}
                    onChange={() =>
                      setChooser((c) => ({ ...c, format: "pdf" }))
                    }
                    className="h-4 w-4"
                  />
                  <span>.pdf (ready to share/print)</span>
                </label>

                <label
                  className={`flex items-center gap-3 ${
                    chooser.busy ? "opacity-50 pointer-events-none" : ""
                  }`}
                >
                  <input
                    type="radio"
                    name="fmt"
                    value="docx"
                    checked={chooser.format === "docx"}
                    onChange={() =>
                      setChooser((c) => ({ ...c, format: "docx" }))
                    }
                    className="h-4 w-4"
                  />
                  <span>.docx (editable in Word/Docs)</span>
                </label>
              </div>

              <div className="px-5 py-4 flex items-center justify-end gap-2 border-t border-white/10">
                <button
                  onClick={closeChooser}
                  disabled={!!chooser.busy}
                  className={`px-3 py-1.5 rounded-lg border border-white/20 ${
                    chooser.busy ? "opacity-50" : "hover:bg-white/5"
                  }`}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmGenerate}
                  disabled={!!chooser.busy}
                  className={`px-3 py-1.5 rounded-lg bg-indigo-500 text-white ${
                    chooser.busy ? "opacity-60" : "hover:bg-indigo-600"
                  }`}
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

  // wrapper
  if (mode === "embedded") {
    return (
      <>
        <Header embedded />
        <Content />
      </>
    );
  }

  return (
    <>
      <div
        className={styles.overlay}
        style={{
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
        }}
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
