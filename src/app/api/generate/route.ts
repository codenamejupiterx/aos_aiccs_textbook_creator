/* eslint-disable */
// src/app/api/generate/route.ts

import { NextResponse } from "next/server";
import crypto from "crypto";
import { getOpenAI } from "@/lib/openai";
import { putItem, updatePassion } from "@/lib/dynamo";
import { putText } from "@/lib/s3";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

type Body = {
  email?: string;          // optional; prefer session
  subject: string;
  passion: string;
  ageRange: string;
  notes?: string;
  passionLikes?: string[];
};

function reqd(x: unknown, name: string): string {
  const v = (typeof x === "string" ? x.trim() : "");
  if (!v) throw new Error(`Missing field: ${name}`);
  return v;
}

/* ---------- Local fallback helpers (used when OpenAI quota/misconfig) ---------- */
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

function buildLocalWeek1(
  subject: string,
  passion: string,
  ageRange: string,
  likes: string[],
  notes: string
) {
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
/* ----------------------------------------------------------------------------- */

export async function POST(req: Request) {
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  const startedAt = Date.now();

  try {
    const body = (await req.json()) as Body;

    // Prefer email from NextAuth session; allow body override for CLI/tests
    const session = await auth();
    const sessionEmail = (session?.user as any)?.email?.trim?.() || "";
    const email = (body.email && body.email.trim()) || sessionEmail;
    if (!email) {
      return NextResponse.json(
        { ok: false, error: "Not authenticated: missing email (sign in or include email in body)" },
        { status: 401 }
      );
    }

    const subject = reqd(body.subject, "subject");
    const passion = reqd(body.passion, "passion");
    const ageRange = reqd(body.ageRange, "ageRange");
    const notes = (body.notes ?? "").trim();
    const passionLikes = Array.isArray(body.passionLikes) ? body.passionLikes.slice(0, 10) : [];

    // ENV (surface in success/debug for sanity)
    const region = process.env.AWS_REGION || "us-east-1";
    const table = process.env.DDB_TABLE || "TextbookCreator";
    const bucket = process.env.BUCKET || process.env.AWS_S3_BUCKET || "";

    // ---------- 1) Prepare IDs/keys & initial write (status: pending) ----------
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

    // Write the row first (so UI can list it immediately)
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

    // ---------- 2) Generate curriculum + chapter (OpenAI → fallback) ----------
    let curriculum16: any[] | null = null;
    let week1Chapter: { title: string; body: string } | null = null;
    let openaiError: string | null = null;

    try {
      const openai = getOpenAI(); // throws if OPENAI_API_KEY missing
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
      const parsed = JSON.parse(content);
      curriculum16 = Array.isArray(parsed?.curriculum16) ? parsed.curriculum16 : null;
      week1Chapter = parsed?.week1Chapter ?? null;
    } catch (e: any) {
      openaiError = e?.message || String(e);
      curriculum16 = buildLocalCurriculum(subject, passion, passionLikes);
      week1Chapter = buildLocalWeek1(subject, passion, ageRange, passionLikes, notes);
    }

    if (!curriculum16 || !week1Chapter) {
      throw new Error("Generation failed (OpenAI+fallback both empty).");
    }

    // ---------- 3) Best-effort S3 writes; mark record ready on success ----------
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
        // keep the row; it will remain "pending"
      }
    }

    // ---------- 4) Success ----------
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
    const payload: any = { ok: false, error: msg };
    if (debug) {
      payload.stack = err?.stack || null;
      payload.env = {
        hasOpenAIKey: Boolean(process.env.OPENAI_API_KEY),
        region: process.env.AWS_REGION,
        table: process.env.DDB_TABLE,
        bucket: process.env.BUCKET || process.env.AWS_S3_BUCKET || "",
      };
    }
    return NextResponse.json(payload, { status: 500 });
  }
}
