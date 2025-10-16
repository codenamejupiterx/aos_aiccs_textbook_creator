/* eslint-disable */
// src/app/api/generate/route.ts
//import { NextResponse } from "next/server";
import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { z } from "zod";
import { getOpenAI } from "@/lib/openai";
import { putItem, updatePassion } from "@/lib/dynamo";
import { putText } from "@/lib/s3";
import { auth } from "@/lib/auth";
import { rl } from "@/lib/ratelimit"; // ensure this exists (e.g. Upstash wrapper)

export const runtime = "nodejs";

/* ----------------------------- ZOD VALIDATION ----------------------------- */
const BodySchema = z.object({
  email: z.string().email().optional(),
  subject: z.string().min(1).max(120),
  passion: z.string().min(1).max(120),
  ageRange: z.enum(["Grades 3–5", "Grades 6–8", "Grades 9–12", "College / Adult"]),
  notes: z.string().max(2000).optional().default(""),
  passionLikes: z.array(z.string().min(1).max(40)).max(10).optional().default([]),
});
type Body = z.infer<typeof BodySchema>;

/* ----------------------------- Local fallbacks ---------------------------- */
function buildLocalCurriculum(subject: string, passion: string, likes: string[]) {
  const weeks = Array.from({ length: 16 }, (_, i) => i + 1);
  return weeks.map((w) => ({
    week: w,
    title: `${subject} × ${passion}: Week ${w}`,
    goals: [
      `Advance ${subject} skills with a ${passion}-themed activity`,
      `Practice key problem types for Week ${w}`,
      `Connect concepts to real examples${likes?.length ? ` (${likes.slice(0, 2).join(", ")})` : ""}`,
    ],
    topics: [`${subject} topic set ${w}`, `Applied example using ${passion}`],
    activity: `Hands-on: mini task using ${passion} context (Week ${w}).`,
  }));
}
function buildLocalWeek1(subject: string, passion: string, ageRange: string, likes: string[], notes: string) {
  const body = [
    `Welcome! This first week introduces core ideas in ${subject} using a ${passion} theme.`,
    likes?.length ? `We’ll also weave in what you enjoy: ${likes.join(", ")}.` : "",
    notes ? `Teacher notes considered: ${notes}` : "",
    "",
    "Objectives:",
    "- Build comfort with key vocabulary and formats.",
    `- See how ${subject} appears in everyday ${passion} contexts.`,
    "- Complete a short practice set and a mini project.",
    "",
    "Mini-project: Create a simple poster/slide that explains one concept from today using a real " +
      `${passion} example.`,
    "",
    "Exit Ticket: 3 quick questions + 1 reflection sentence.",
    "",
    "Rubric (Week 1, 10 pts): Accuracy(4), Clarity(3), Effort(2), Reflection(1).",
  ].join("\n");
  return { title: `Week 1 — ${subject} via ${passion} (${ageRange})`, body };
}

/* ----------------------------- Helpers ----------------------------------- */
// robust IP extractor (x-forwarded-for may contain a list)
function getClientIP(req: Request) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") || "unknown";
}

/* --------------------------------- ROUTE ---------------------------------- */
/* --------------------------------- ROUTE ---------------------------------- */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "1";
  const startedAt = Date.now();

  // ── 0) CSRF FIRST (fail fast) ─────────────────────────────────────────────
  {
    const headerToken =
      req.headers.get("x-csrf-token") ||
      req.headers.get("x-csrf") ||
      "";

    // Prefer your own cookie; fall back to NextAuth cookie names if present
    const rawCookie =
      req.cookies.get("csrf_token")?.value ||
      req.cookies.get("next-auth.csrf-token")?.value ||
      req.cookies.get("authjs.csrf-token")?.value ||
      "";

    // NextAuth style is "token|hash"; keep only the left side; also decode %7C etc.
    const cookieToken = decodeURIComponent(rawCookie).split("|")[0] || "";

    if (!headerToken || headerToken !== cookieToken) {
      return NextResponse.json({ ok: false, error: "bad_csrf" }, { status: 403 });
    }
  }

  // ── 0b) Optional same-origin belt (uncomment to enable) ───────────────────
  /*
  {
    const origin = req.headers.get("origin");
    const allowed = new Set(
      ["http://localhost:3000", process.env.APP_PUBLIC_URL || ""]
        .filter(Boolean)
        .map(o => new URL(o).origin)
    );
    if (origin && !allowed.has(new URL(origin).origin)) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  }
  */

  try {
    // 1) Auth (prefer session)
    const session = await auth();
    const sessionEmail = (session?.user as any)?.email?.trim?.() || "";

    // 2) Validate body (Zod)
    let parsed: Body;
    try {
      parsed = BodySchema.parse(await req.json());
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: "invalid_input", detail: e?.message },
        { status: 400 }
      );
    }

    const email = (parsed.email || sessionEmail).trim();
    if (!email) {
      return NextResponse.json(
        { ok: false, error: "unauthorized", detail: "missing email (sign in or include email in body)" },
        { status: 401 }
      );
    }

    // 3) Rate limit (before heavy work)
    {
      const ip = getClientIP(req);
      const { success, reset } = await rl.limit(`gen:${ip}`);
      if (!success) {
        const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
        return new NextResponse(
          JSON.stringify({ ok: false, error: "rate_limited", retryAfter }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Retry-After": String(retryAfter),
              "Cache-Control": "no-store",
            },
          }
        );
      }
    }

    // 4) Extract safe values
    const subject = parsed.subject.trim();
    const passion = parsed.passion.trim();
    const ageRange = parsed.ageRange;
    const notes = parsed.notes?.trim() ?? "";
    const passionLikes = (parsed.passionLikes ?? []).slice(0, 10);

    // ENV surface
    const region = process.env.AWS_REGION || "us-east-1";
    const table = process.env.DDB_TABLE || "TextbookCreator";
    const bucket = process.env.BUCKET || process.env.AWS_S3_BUCKET || "";

    // 5) Prepare IDs/keys & initial write
    const passionId = `passion_${crypto.randomUUID()}`;
    const entity = `passion#${passionId}`;
    const nowIso = new Date().toISOString();

    const emailSafe = email.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const prefix = `textbook/${emailSafe}/${passionId}/`;
    const keys = {
      curriculum: `${prefix}curriculum16.json`,
      chapter: `${prefix}week1_chapter.md`,
      merged: `${prefix}summary.txt`,
    };

    await putItem({
      userId: email,
      entity,
      passionId,
      subject,
      passion,
      ageRange,
      notes,
      passionLikes,
      bucket,
      s3CurriculumKey: keys.curriculum,
      s3ChapterKey: keys.chapter,
      s3MergedKey: keys.merged,
      status: "pending",
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 6) Generate (OpenAI → fallback)
    let curriculum16: any[] | null = null;
    let week1Chapter: { title: string; body: string } | null = null;
    let openaiError: string | null = null;

    try {
      const openai = getOpenAI();
      const sys = "You are an expert educator who produces structured JSON only.";
      const userPrompt = `
Return STRICT JSON with "curriculum16" (16 items) and "week1Chapter" (title/body),
for subject ${subject}, age range ${ageRange}, themed around "${passion}".
Likes: ${JSON.stringify(passionLikes)}. Notes: ${notes || "(none)"}.
Format:
{
  "curriculum16":[{"week":1,"title":"","goals":[],"topics":[],"activity":""},...],
  "week1Chapter":{"title":"","body":""}
}`.trim();

      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        response_format: { type: "json_object" },
        temperature: 0.4,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
      });

      const content = completion.choices?.[0]?.message?.content || "{}";
      const parsedJSON = JSON.parse(content);
      curriculum16 = Array.isArray(parsedJSON?.curriculum16) ? parsedJSON.curriculum16 : null;
      week1Chapter = parsedJSON?.week1Chapter ?? null;
    } catch (e: any) {
      openaiError = e?.message || String(e);
      curriculum16 = buildLocalCurriculum(subject, passion, passionLikes);
      week1Chapter = buildLocalWeek1(subject, passion, ageRange, passionLikes, notes);
    }

    if (!curriculum16 || !week1Chapter) {
      throw new Error("Generation failed (OpenAI+fallback both empty).");
    }

    // 7) S3 writes & mark ready
    const s3: Record<string, string> = {};
    if (bucket) {
      try {
        const curriculumText = JSON.stringify(curriculum16, null, 2);
        const chapterText = `# ${week1Chapter.title || "Week 1"}\n\n${week1Chapter.body || ""}`;

        await putText(bucket, keys.curriculum, curriculumText, "application/json");
        await putText(bucket, keys.chapter, chapterText, "text/markdown; charset=utf-8");
        await putText(
          bucket,
          keys.merged,
          `Curriculum:\n${curriculumText}\n\n---\n\nChapter:\n${chapterText}`,
          "text/plain; charset=utf-8"
        );

        Object.assign(s3, { bucket, ...keys });

        await updatePassion(email, entity, {
          status: "ready",
          updatedAt: new Date().toISOString(),
        });
      } catch (e) {
        console.error("[S3] putText failed:", e);
        // keep "pending"
      }
    }

    // 8) Success
    return NextResponse.json({
      ok: true,
      tookMs: Date.now() - startedAt,
      region,
      table,
      s3: Object.keys(s3).length ? s3 : null,
      passionId,
      curriculum16,
      week1Chapter,
      ...(debug ? { openaiError, sessionEmail } : {}),
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error("[/api/generate] ERROR:", msg, err?.stack || "");
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
