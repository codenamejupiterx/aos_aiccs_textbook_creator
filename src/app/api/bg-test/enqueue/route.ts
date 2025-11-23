// src/app/api/bg-test/enqueue/route.ts
/* eslint-disable */
export const runtime = "nodejs";

import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { getOpenAI } from "@/lib/openai";
import { putItem, updatePassion } from "@/lib/dynamo";
import { putText } from "@/lib/s3";
import { BodySchema } from "../../generate/schema"; // same Zod schema as /api/generate

const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";
const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DDB_TABLE || "TextbookCreator";
const BUCKET = process.env.BUCKET || process.env.AWS_S3_BUCKET || "";

export async function POST(req: NextRequest) {
  console.log("[bg-test enqueue] start");

  try {
    // ── 1) Auth ─────────────────────────────────────────────────────────────
    const session = await auth();
    const email = (session?.user as any)?.email?.trim?.() || "";

    if (!email) {
      return NextResponse.json(
        { ok: false, error: "unauthorized" },
        { status: 401 }
      );
    }

    // ── 2) Validate body (same schema as /api/generate) ─────────────────────
    let parsed: any;
    try {
      const body = await req.json();
      parsed = BodySchema.parse(body);
    } catch (e: any) {
      return NextResponse.json(
        { ok: false, error: "invalid_input", detail: e?.message },
        { status: 400 }
      );
    }

    const subject = parsed.subject.trim();
    const passion = parsed.passion.trim();
    const ageRange = parsed.ageRange;
    const notes = (parsed.notes ?? "").trim();
    const passionLikes: string[] = (parsed.passionLikes ?? []).slice(0, 10);

    const nowIso = new Date().toISOString();
    const passionId = `passion_${crypto.randomUUID()}`;
    const entity = `passion#${passionId}`;

    const emailSafe = email.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const prefix = `textbook/${emailSafe}/${passionId}/`;
    const keys = {
      curriculum: `${prefix}curriculum16.json`,
      chapter: `${prefix}week1_chapter.md`,
      merged: `${prefix}summary.txt`,
    };

    // ── 3) Initial write with status=pending (so UI could show “in progress”) ─
    await putItem({
      userId: email,
      entity,
      passionId,
      subject,
      passion,
      ageRange,
      notes,
      passionLikes,
      bucket: BUCKET,
      s3CurriculumKey: keys.curriculum,
      s3ChapterKey: keys.chapter,
      s3MergedKey: keys.merged,
      status: "pending",
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // ── 4) Call OpenAI to build curriculum + week 1 ────────────────────────
    let curriculum16: any[] | null = null;
    let week1Chapter: { title: string; body: string } | null = null;

    try {
      const openai = getOpenAI();
      const sys =
        "You are an expert educator and instructional designer. You must return ONLY valid, minified JSON that conforms exactly to the provided schema. Do not include prose, markdown, comments, or trailing commas.";

      const userPrompt = `
Create a 16-week curriculum plan and a long-form Week 1 chapter.

Subject: ${subject}
Age range: ${ageRange}
Theme: "${passion}"
Learner likes (verbatim JSON): ${JSON.stringify(passionLikes)}
Teacher/learner notes: ${notes || "(none)"}

### OUTPUT SCHEMA
{
  "curriculum16": [
    {
      "week": 1,
      "title": "",
      "goals": ["", ""],
      "topics": ["", ""],
      "activity": "",
      "assessment": ""
    }
  ],
  "week1Chapter": {
    "title": "",
    "abstract": "",
    "sections": [
      { "heading": "", "body": "" }
    ],
    "figures": [],
    "citations_style": "APA",
    "intext_citations": true,
    "references": [],
    "ai_generated": false,
    "estimated_word_count": 1400
  }
}
Return ONLY compact JSON.
`.trim();

      const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        response_format: { type: "json_object" },
        temperature: 0.4,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
      });

      const content = completion.choices?.[0]?.message?.content || "{}";
      const parsedJSON = JSON.parse(content);
      curriculum16 = Array.isArray(parsedJSON?.curriculum16)
        ? parsedJSON.curriculum16
        : null;
      week1Chapter = parsedJSON?.week1Chapter ?? null;
    } catch (e: any) {
      console.error("[bg-test enqueue] OpenAI error, using fallback:", e);

      curriculum16 = [
        {
          week: 1,
          title: `Week 1 — ${subject} via ${passion}`,
          goals: ["Start learning with your passion"],
          topics: [subject, passion],
          activity: `Simple intro activity combining ${subject} and ${passion}.`,
          assessment: "Short exit ticket.",
        },
      ];
      week1Chapter = {
        title: `Week 1 — ${subject} via ${passion} (${ageRange})`,
        body: `Fallback week 1 chapter for ${subject} via ${passion}.`,
      };
    }

    if (!curriculum16 || !week1Chapter) {
      throw new Error("Generation failed (OpenAI+fallback both empty)");
    }

    // ── 5) S3 writes ────────────────────────────────────────────────────────
    if (BUCKET) {
      const curriculumText = JSON.stringify(curriculum16, null, 2);
      const chapterText = `# ${week1Chapter.title || "Week 1"}\n\n${
        week1Chapter.body || ""
      }`;

      await putText(
        BUCKET,
        keys.curriculum,
        curriculumText,
        "application/json"
      );
      await putText(
        BUCKET,
        keys.chapter,
        chapterText,
        "text/markdown; charset=utf-8"
      );
      await putText(
        BUCKET,
        keys.merged,
        `Curriculum:\n${curriculumText}\n\n---\n\nChapter:\n${chapterText}`,
        "text/plain; charset=utf-8"
      );
    } else {
      console.warn("[bg-test enqueue] BUCKET not configured; skipping S3 writes");
    }

    // ── 6) Mark passion row as ready ────────────────────────────────────────
    await updatePassion(email, entity, {
      status: "ready",
      updatedAt: new Date().toISOString(),
    });

    console.log("[bg-test enqueue] finished; created passion", passionId);

    // front-end only needs passionId to highlight/scroll
    return NextResponse.json(
      { ok: true, passionId },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[bg-test enqueue] error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "unknown_error" },
      { status: 500 }
    );
  }
}
