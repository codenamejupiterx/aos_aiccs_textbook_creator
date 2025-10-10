// src/app/api/passions/[id]/weeks/[week]/chapter/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getItemByUserEntity } from "@/lib/dynamo";
import { getOpenAI } from "@/lib/openai";

export const runtime = "nodejs";

type ChapterReq = { title: string };

function sanitizeFilename(name: string) {
  return name.replace(/[^\w\s.-]/g, "").trim().replace(/\s+/g, "_").slice(0, 80);
}

function buildPrompt(p: {
  subject_var: string;
  ageRange_var: string;
  chapter_title_var: string;
  passion_var: string;
  passionLikes_var: string[] | string;
}) {
  const { subject_var, ageRange_var, chapter_title_var, passion_var, passionLikes_var } = p;
  const likesText = Array.isArray(passionLikes_var) ? passionLikes_var.join(", ") : String(passionLikes_var || "");
  return [
    `You are a skilled, user-customized textbook chapter writer.`,
    `Write a complete chapter on **${subject_var}** for a learner in the age range **${ageRange_var}**.`,
    `Base the chapter on the chapter title: **${chapter_title_var}**.`,
    `Weave the writing around the user's passion: **${passion_var}**.`,
    likesText
      ? `Specifically highlight the user's favorite aspects of ${passion_var}: **${likesText}**.`
      : `If favorite aspects are not provided, still anchor examples in ${passion_var}.`,
    ``,
    `Requirements:`,
    `- Use clear, engaging explanations appropriate for ${ageRange_var}.`,
    `- Include short examples tied to ${passion_var} (use the favorites when applicable).`,
    `- Add 3–5 quick-check questions at the end (with answers).`,
    `- Format as Markdown with headings, subheadings, and bullet points where helpful.`,
  ].join("\n");
}

export async function POST(req: Request, { params }: { params: { id: string; week: string } }) {
  const url = new URL(req.url);
  const debugMode = url.searchParams.get("debug") === "1";
  const dryrun = url.searchParams.get("dryrun") === "1";

  try {
    // 1) Auth
    const session = await auth();
    const email = (session?.user as any)?.email as string | undefined;
    if (!email) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    // 2) Params & body
    const rawId = decodeURIComponent(params.id || "");
    const weekNum = Number(params.week || "0");
    if (!rawId || !Number.isFinite(weekNum) || weekNum <= 0) {
      return NextResponse.json({ ok: false, error: "missing or invalid params" }, { status: 400 });
    }

    let body: ChapterReq;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 });
    }
    const chapterTitle = String(body?.title || "").trim();
    if (!chapterTitle) {
      return NextResponse.json({ ok: false, error: "missing title" }, { status: 400 });
    }

    // 3) Build candidate keys to match your table schema
    const base = rawId
      .replace(/^passion_/, "")
      .replace(/^PASSION#/, "")
      .replace(/^passion#/, "");

    const entitySet = new Set<string>([
      `passion#${base}`, // your actual table
      rawId.startsWith("passion#") || rawId.startsWith("PASSION#") ? rawId : `passion#${rawId}`,
      `PASSION#${base}`, // tolerate uppercase, if any
    ]);
    const entityCandidates = Array.from(entitySet);

    const userIdCandidates = [email, email.toLowerCase().trim()];

    // 4) Fetch passion row
    let passion: any = null;
    const tried: Array<{ userId: string; entity: string }> = [];

    outer: for (const userId of userIdCandidates) {
      for (const entity of entityCandidates) {
        tried.push({ userId, entity });
        // eslint-disable-next-line no-await-in-loop
        const rec = await getItemByUserEntity(userId, entity);
        if (rec) {
          passion = rec;
          break outer;
        }
      }
    }

    if (!passion) {
      return NextResponse.json(
        { ok: false, error: "passion not found", ...(debugMode ? { debug: { email, rawId, tried } } : {}) },
        { status: 404 }
      );
    }

    // 5) Validate required fields
    const subject_var = String(passion.subject ?? "");
    const ageRange_var = String(passion.ageRange ?? "");
    const passion_var = String(passion.passion ?? "");
    const passionLikes_var = passion.passionLikes ?? [];

    if (!subject_var || !ageRange_var || !passion_var) {
      return NextResponse.json(
        {
          ok: false,
          error: "missing required fields in DynamoDB (need subject, ageRange, passion)",
          ...(debugMode ? { debug: { keys: Object.keys(passion || {}) } } : {}),
        },
        { status: 400 }
      );
    }

    // ✅ DRY RUN: stop before OpenAI to isolate DB vs model issues
    if (dryrun) {
      return NextResponse.json(
        {
          ok: true,
          mode: "dryrun",
          found: { subject_var, ageRange_var, passion_var, passionLikes_var },
          ...(debugMode ? { debug: { email, rawId, entityCandidates, tried } } : {}),
        },
        { status: 200 }
      );
    }

    // 6) OpenAI → generate chapter
    const systemMsg =
      "You write accurate, engaging, age-appropriate textbook chapters with clear structure and examples.";
    const userMsg = buildPrompt({
      subject_var,
      ageRange_var,
      chapter_title_var: chapterTitle,
      passion_var,
      passionLikes_var,
    });

    const openai = getOpenAI();
    // Optional: small presence check; avoids throwing vague 500s
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "OPENAI_API_KEY missing on server" },
        { status: 500 }
      );
    }

    const model = process.env.OPENAI_MODEL || process.env.OPENAI_TEXT_MODEL || "gpt-4o";
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.5,
      messages: [
        { role: "system", content: systemMsg },
        { role: "user", content: userMsg },
      ],
    });

    const content = completion.choices?.[0]?.message?.content?.trim() || "# Chapter\n\n(Empty content returned.)";

    // 7) Download markdown
    const filename = `${sanitizeFilename(`chapter_week${weekNum}_${chapterTitle || "Untitled"}`)}.md`;
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    // Strong error: return details if debug=1, otherwise a generic 500
    const safe = String(e?.message || e);
    const payload: any = { ok: false, error: "server_error", message: safe };
    if (debugMode) payload.stack = e?.stack;
    // Optional: log on server
    console.error("[chapter route] 500:", safe, e?.stack);
    return NextResponse.json(payload, { status: 500 });
  }
}
