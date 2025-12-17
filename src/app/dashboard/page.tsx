/* eslint-disable */
// src/app/dashboard/page.tsx
"use client";

import { useEffect, useState} from "react";
import { createPortal } from "react-dom";
import PassionsPanel from "@/components/PassionsPanel";
import Topbar from "@/components/Topbar";
import { PassionLikesInput } from "@/components/PassionLikesInput";

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

// --- helper: read cookie value ---
// ===== helpers (place near top of the file, outside the component) =====
// --- helpers (top of file) ---
function getCookie(name: string) {
  const raw = document.cookie
    .split("; ")
    .find(p => p.startsWith(name + "="))
    ?.split("=")[1];
  return raw ? decodeURIComponent(raw) : "";
}

/**
 * Returns a CSRF token from any of the supported cookies:
 *  - csrf_token                       (your app’s cookie)
 *  - next-auth.csrf-token            (NextAuth v5; value is "token|hash")
 *  - authjs.csrf-token               (older name; value is "token|hash")
 * Always decodes and returns ONLY the left side before the pipe.
 */
export function getAnyCsrfTokenLeftSide(): string {
  const raw =
    getCookie("csrf_token") ||
    getCookie("next-auth.csrf-token") ||
    getCookie("authjs.csrf-token") ||
    "";

  if (!raw) return "";
  // NextAuth format is "token|hash" (often URL-encoded where "|" => %7C)
  const left = raw.split("|")[0]; // split handles both encoded/decoded because getCookie decodes
  return left || "";
}


async function ensureCsrf() {
  if (
    !getCookie("csrf_token") &&
    !getCookie("next-auth.csrf-token") &&
    !getCookie("authjs.csrf-token")
  ) {
    // was /api/ping — change to /api/csrf
    await fetch("/api/csrf", { cache: "no-store", credentials: "same-origin" });
  }
}






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
  

   // success modal
  const [successId, setSuccessId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  


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
  ///1.load passions + window listeners
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

// 2) make sure CSRF exists
useEffect(() => {
  // make sure middleware runs and a CSRF cookie exists in this tab
  ensureCsrf().catch(() => {});
}, []);

// 3) highlight scroll effect
  useEffect(() => {
    if (!highlightId) return;
    const el = document.getElementById("aos-new-passion");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [highlightId]);

  // ----- form state -----
  const [loading, setLoading] = useState(false);
  const [ageRange, setAgeRange] = useState("");
  const [subject, setSubject] = useState("");
  const [passion, setPassion] = useState("");
  const [notes, setNotes] = useState("");
  const [passionLikes, setPassionLikes] = useState<string[]>([]);
 

  const [subjectError, setSubjectError] = useState("");
  const [passionError, setPassionError] = useState("");

  const SUBJECT_MAX = 120;
  const PASSION_MAX = 120;

 

  

function getNextAuthCsrfTokenOnly(): string {
  const raw =
    getCookie("next-auth.csrf-token") || // v5
    getCookie("authjs.csrf-token") || ""; // old name

  // cookie value is "token|hash" and may be URL-encoded ("%7C")
  const decoded = decodeURIComponent(raw);
  return decoded.split("|")[0] ?? "";
}

// async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
//   e.preventDefault();
//   setLoading(true);
//   setErrorMsg(null);
//   setSuccessId(null);

//   try {
//     const payload = {
//       subject: subject.trim(),
//       passion: passion.trim(),
//       ageRange: ageRange.trim(),
//       notes: notes.trim(),
//       passionLikes, // ← already an array of strings
//     };

//   // Read any supported CSRF source (decoded & left-part only)
//   let csrf = getAnyCsrfTokenLeftSide();
//   if (!csrf) {
//     await ensureCsrf();                 // should call /api/csrf with same-origin
//     csrf = getAnyCsrfTokenLeftSide();   // re-read after cookie is set
//   }

//   const res = await fetch("/api/generate?debug=1", {
//     method: "POST",
//     credentials: "same-origin",
//     headers: {
//       "Content-Type": "application/json",
//       "x-csrf-token": csrf || "",
//     },
//     body: JSON.stringify(payload),
//   });

//     if (res.status === 401) throw new Error("You must be signed in.");
//     if (!res.ok) throw new Error(`Server error ${res.status}: ${await res.text()}`);

//     const data = await res.json();
//     await loadPassions();
//     setSuccessId(data?.passionId ? String(data.passionId) : "ready");
//   } catch (err: any) {
//     console.error("generate failed:", err);
//     setErrorMsg(err?.message || "Failed to generate.");
//   } finally {
//     setLoading(false);
//   }
// }

async function pollBgJobForPassionId(jobId: string) {
  const started = Date.now();
  const timeoutMs = 100_000; // 3min
  const intervalMs = 1200;

  while (Date.now() - started < timeoutMs) {
    const res = await fetch(`/api/bg-test/status/${encodeURIComponent(jobId)}`, {
      cache: "no-store",
      credentials: "same-origin",
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Status check failed ${res.status}: ${txt.slice(0, 200)}`);
    }

    const data = await res.json();

    // ✅ handle real failure state
    if (data?.status === "failed") {
      throw new Error(data?.error || "Background job failed.");
    }

    // (keep this too, just in case your status route uses it)
    if (data?.status === "error") {
      throw new Error(data?.error || "Background job failed.");
    }

    // ✅ if done and passionId exists, return it
    if (data?.status === "done" && data?.passionId) {
      return String(data.passionId);
    }

    // ✅ if done but passionId missing, STOP polling (don’t spin forever)
    if (data?.status === "done" && !data?.passionId) {
      return null;
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error("Timed out waiting for background job to finish.");
}




async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  setLoading(true);
  setErrorMsg(null);
  setSuccessId(null);

  try {
    const payload = {
      subject: subject.trim(),
      passion: passion.trim(),
      ageRange: ageRange.trim(),
      notes: notes.trim(),
      passionLikes,
    };

    // --- CSRF handling ---
    let csrf = getAnyCsrfTokenLeftSide();
    if (!csrf) {
      await ensureCsrf();
      csrf = getAnyCsrfTokenLeftSide();
    }

    const res = await fetch("/api/bg-test", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": csrf || "",
      },
      body: JSON.stringify(payload),
    });

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      // ignore
    }

    if (res.status === 401) throw new Error("You must be signed in.");
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `Server error ${res.status}`);
    }

    // ✅ If API returns passionId immediately (fast path)
    let passionId: string | null = data?.passionId ? String(data.passionId) : null;

    // ✅ Otherwise, use queued jobId and poll
    if (!passionId) {
      const jobId = data?.jobId ? String(data.jobId) : "";
      if (!jobId) {
        console.log("bg-test response:", data);
        throw new Error("Unexpected response from server (missing passionId/jobId).");
      }
      passionId = await pollBgJobForPassionId(jobId);
    }

    await loadPassions();

    if (passionId) {
      setHighlightId(passionId);
      setSuccessId(passionId);
    } else {
      setSuccessId("ready");
    }
    setPanelOpen(true);

    // ✅ clear form
    setAgeRange("");
    setSubject("");
    setPassion("");
    setNotes("");
    setPassionLikes([]);
  } catch (err: any) {
    console.error("bg-test failed:", err);
    setErrorMsg(err?.message || "Failed to submit request.");
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
      {/* Header */}
      <div className="relative topbar-compact">
        <Topbar />
        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="aos-mini-btn absolute right-4 top-1/2 -translate-y-1/2 z-50 w-[220px] select-none rounded-2xl bg-emerald-500 px-6 py-3 text-white font-semibold shadow-lg shadow-emerald-900/20 ring-1 ring-emerald-400/20 hover:bg-emerald-400 active:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-400 transition"
        >
          My Mini-Chapters
        </button>


      </div>

      {/* Main form */}
      <main className="overflow-auto">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
          <section className="px-2 sm:px-[96px]">
            <div className="aos-form-card rounded-3xl border border-white/10 bg-[#222833] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.8)] py-8 px-6 sm:px-8">
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
                      maxLength={120}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Algebra I, U.S. History, Biology…"
                      required
                    />
                    <p className="text-xs text-gray-400 mt-1">{subject.length}/120</p>
                  </div>

                  <div>
                    <label className={label}>Passion *</label>
                    <input
                      className={field}
                      value={passion}
                      maxLength={120}
                      onChange={(e) => setPassion(e.target.value)}
                      placeholder="Football, anime, nails, cooking, Roblox…"
                      required
                    />
                    <p className="text-xs text-gray-400 mt-1">{passion.length}/120</p>
                  </div>


                  <div>
                    <label className={label}>Add things you love about this passion (one at a time)*</label>

                    <PassionLikesInput value={passionLikes} onChange={setPassionLikes} />

                    <p className="text-xs text-gray-400 mt-2">
                      Add one item, click Add, then repeat — up to 20 total.
                    </p>
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
          highlightedId={highlightId || undefined}   // 👈
        />
      ) : (
        <PassionsPanel
          passions={passions}
          onRefresh={loadPassions}
          mode="standalone"
          title="Mini-Chapters"
          defaultOpen
          onClose={() => setPanelOpen(false)}
          highlightedId={highlightId || undefined}   // 👈
        />
      ))}
     


      {/* Processing overlay */}
      {loading && (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-black/60 backdrop-blur-sm">
          <div className="rounded-2xl bg-[#0f1216] p-6 shadow-xl border border-white/10 text-center">
            <img src="/aos_logo_v1.png" alt="Processing…" className="mx-auto h-24 w-24" />
            <h3 className="mt-4 text-white text-lg font-medium">Building your readings…</h3>
            <p className="mt-1 text-sm text-gray-400">
              This usually takes a moment. You can stay on this page.
            </p>
          </div>
        </div>
      )}

      {/* Success modal */}
      {successId && (
        <div className="fixed inset-0 z-[9999] grid place-items-center bg-black/60 backdrop-blur-sm">
          <div className="w-[min(92vw,520px)] rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-xl font-semibold text-gray-900">Your readings are ready!</h3>
            <p className="mt-2 text-gray-600">
              Click <span className="font-medium">My Mini-Chapters</span> at the top to access them.
            </p>

            <div className="mt-5 flex gap-3">
              <button
                onClick={async () => 
                  {
                    if (!successId) {
                      setSuccessId(null);
                      return;
                    }

                    try {
                      await loadPassions();
                      setPanelOpen(true);

                      // highlight only if successId is a real passionId
                      if (successId !== "ready") {
                        setHighlightId(successId);
                      }

                      // clear form + close modal
                      setAgeRange("");
                      setSubject("");
                      setPassion("");
                      setNotes("");
                      setPassionLikes([]);
                      setSuccessId(null);
                    } catch (e) {
                      console.error("open mini-chapters error:", e);
                      setErrorMsg("Something went wrong opening your mini-chapters.");
                      setSuccessId(null);
                    }
                  }
                }
                
                className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-white shadow hover:shadow-md"
              >

              
                Open My Mini-Chapters
              </button>
            </div>

            {successId !== "ready" && (
              <p className="mt-3 text-xs text-gray-500">(Passion ID: {successId})</p>
            )}
          </div>
        </div>
      )}

      <style jsx global>{`
        .topbar-compact > div {
          padding: 0.5rem !important;
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
