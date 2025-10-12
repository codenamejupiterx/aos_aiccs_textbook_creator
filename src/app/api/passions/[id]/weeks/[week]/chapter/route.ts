// src/app/api/passions/[id]/weeks/[week]/chapter/route.ts
/* eslint-disable */
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getItemByUserEntity } from "@/lib/dynamo";
import { getOpenAI } from "@/lib/openai";





// @ts-ignore  // fontkit is JS-only; this keeps TS happy
import fontkit from "@pdf-lib/fontkit";

// point to the static TTF you added
const FONT_PATH = path.join(process.cwd(), "public", "fonts", "NotoSans-Regular.ttf");



import { PDFDocument as PDFLibDoc } from "pdf-lib";
import { promises as fs } from "fs";
import path from "path";

// ---- PDF/DOCX output libs
import { Document, Paragraph, Packer } from "docx";
// use require to avoid esModuleInterop issues
/* import type PDFKitNS from "pdfkit";
const PDFDocument = require("pdfkit") as typeof PDFKitNS; */

type ChapterReq = { title: string };

// --- add this near your other helpers ---
/* function getPdfKitCtor() {
  // works for both require("pdfkit") and import("pdfkit").default
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("pdfkit");
  return (mod && mod.default) ? mod.default : mod;
} */

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

// ---- helpers to build file bytes
async function buildDocxBuffer(title: string, text: string) {
  const paragraphs = (text || "").split(/\r?\n/).map((line) => new Paragraph(line));
  const doc = new Document({ sections: [{ properties: {}, children: [new Paragraph(title), ...paragraphs] }] });
  return await Packer.toBuffer(doc); // Node Buffer
}


let cachedFontBytes: Uint8Array | null = null;

async function loadFontBytes() {
  if (cachedFontBytes) return cachedFontBytes;
  const fontPath = path.join(process.cwd(), "public", "fonts", "NotoSans-Regular.ttf");
  const bytes = await fs.readFile(fontPath);
  cachedFontBytes = new Uint8Array(bytes);
  return cachedFontBytes;
}

async function buildPdfBuffer(title: string, text: string) {
  const pdfDoc = await PDFLibDoc.create();
  pdfDoc.registerFontkit(fontkit);

  // 1) Load STATIC TTF and sanity log
  const raw = await fs.readFile(FONT_PATH);
  const fontBytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  // Small debug — confirm we’re not accidentally reading the variable font
  console.log("[pdf] font path:", FONT_PATH, "bytes:", fontBytes.byteLength);

  // 2) Embed with subsetting disabled to avoid glyph mapping issues
  const bodyFont = await pdfDoc.embedFont(fontBytes, { subset: false });
  const titleFont = bodyFont; // swap to a bold TTF later if you add one

  // 3) Page + layout
  let page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const margin = 54;
  const bodySize = 12;
  const titleSize = 18;
  const lineGap = 14;
  const maxWidth = width - margin * 2;
  let y = height - margin;

  // Title (explicitly pass titleFont)
  page.drawText(title || "Chapter", { x: margin, y, size: titleSize, font: titleFont });
  y -= titleSize + 10;

  // Simple reflow (explicitly pass bodyFont to EVERY drawText)
  const paras = String(text || "").replace(/\r\n/g, "\n").split("\n");
  for (const para of paras) {
    if (!para.trim()) {
      y -= lineGap;
      if (y < margin) { page = pdfDoc.addPage(); y = page.getSize().height - margin; }
      continue;
    }

    let remaining = para.trim();
    while (remaining.length) {
      // longest slice that fits
      let low = 1, high = remaining.length, fit = 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const w = bodyFont.widthOfTextAtSize(remaining.slice(0, mid), bodySize);
        if (w <= maxWidth) { fit = mid; low = mid + 1; } else { high = mid - 1; }
      }
      let cut = fit;
      if (cut < remaining.length) {
        const lastSpace = remaining.lastIndexOf(" ", cut);
        if (lastSpace > 0) cut = lastSpace;
      }

      const line = remaining.slice(0, cut).trimEnd();
      page.drawText(line, { x: margin, y, size: bodySize, font: bodyFont });
      y -= lineGap;
      if (y < margin) { page = pdfDoc.addPage(); y = page.getSize().height - margin; }
      remaining = remaining.slice(cut).trimStart();
    }

    y -= Math.floor(lineGap / 2);
    if (y < margin) { page = pdfDoc.addPage(); y = page.getSize().height - margin; }
  }

  return await pdfDoc.save(); // Uint8Array
}

// POST /api/passions/[id]/weeks/[week]/chapter?format=pdf|docx&debug=1&dryrun=1
export async function POST(req: Request, { params }: { params: { id: string; week: string } }) {
  const url = new URL(req.url);
  const debugMode = url.searchParams.get("debug") === "1";
  const dryrun = url.searchParams.get("dryrun") === "1";
  const format = (url.searchParams.get("format") || "pdf").toLowerCase() as "pdf" | "docx" | "md";

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
    try { body = await req.json(); }
    catch { return NextResponse.json({ ok: false, error: "invalid json body" }, { status: 400 }); }

    const chapterTitle = String(body?.title || "").trim();
    if (!chapterTitle) {
      return NextResponse.json({ ok: false, error: "missing title" }, { status: 400 });
    }

    // 3) Locate passion row
    const base = rawId.replace(/^passion_/, "").replace(/^PASSION#/, "").replace(/^passion#/, "");
    const entityCandidates = Array.from(new Set<string>([
      `passion#${base}`,
      rawId.startsWith("passion#") || rawId.startsWith("PASSION#") ? rawId : `passion#${rawId}`,
      `PASSION#${base}`,
    ]));
    const userIdCandidates = [email, email.toLowerCase().trim()];

    let passion: any = null;
    const tried: Array<{ userId: string; entity: string }> = [];
    outer: for (const userId of userIdCandidates) {
      for (const entity of entityCandidates) {
        tried.push({ userId, entity });
        // eslint-disable-next-line no-await-in-loop
        const rec = await getItemByUserEntity(userId, entity);
        if (rec) { passion = rec; break outer; }
      }
    }
    if (!passion) {
      return NextResponse.json(
        { ok: false, error: "passion not found", ...(debugMode ? { debug: { email, rawId, tried } } : {}) },
        { status: 404 }
      );
    }

    // 4) Validate required fields
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

    // 5) DRY RUN
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

   // 6) OpenAI generation → Markdown content
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
if (!process.env.OPENAI_API_KEY) {
  return NextResponse.json({ ok: false, error: "OPENAI_API_KEY missing on server" }, { status: 500 });
}

const model = process.env.OPENAI_MODEL || process.env.OPENAI_TEXT_MODEL || "gpt-4o";

let content: string;
try {
  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.5,
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg },
    ],
  });

  content =
    completion.choices?.[0]?.message?.content?.trim() ||
    "# Chapter\n\n(Empty content returned.)";
} catch (err: any) {
  console.error("[chapter route] OpenAI failed:", err);
  if (debugMode) {
    return NextResponse.json(
      { ok: false, where: "openai", error: String(err?.message || err) },
      { status: 500 }
    );
  }
  throw err;
}

const baseName = sanitizeFilename(`chapter_week${weekNum}_${chapterTitle || "Untitled"}`);

// 7) Emit in requested format (streamed bytes to satisfy BodyInit without Blob)
if (format === "docx") {
  try {
    const buf = await buildDocxBuffer(chapterTitle || `Week ${weekNum} Chapter`, content);
    const bytes = new Uint8Array(buf); // Node Buffer -> Uint8Array

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${baseName}.docx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[chapter route] DOCX export failed:", err);
    if (debugMode) {
      return NextResponse.json(
        { ok: false, where: "docx", error: String(err?.message || err) },
        { status: 500 }
      );
    }
    throw err;
  }
}

if (format === "pdf") {
  try {
    const buf = await buildPdfBuffer(chapterTitle || `Week ${weekNum} Chapter`, content);
    const bytes = new Uint8Array(buf); // Node Buffer -> Uint8Array

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[chapter route] PDF export failed:", err);
    if (debugMode) {
      return NextResponse.json(
        { ok: false, where: "pdf", error: String(err?.message || err) },
        { status: 500 }
      );
    }
    throw err;
  }
}

// Fallback: Markdown
return new Response(content, {
  status: 200,
  headers: {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename="${baseName}.md"`,
    "Cache-Control": "no-store",
  },
});
} catch (e: any) {
  // ⬅︎ closes the OUTER try { … } that began earlier in POST
  const safe = String(e?.message || e);
  const payload: any = { ok: false, error: "server_error", message: safe };
  if (debugMode) payload.stack = e?.stack;
  console.error("[chapter route] 500:", safe, e?.stack);
  return NextResponse.json(payload, { status: 500 });
} // ⬅︎ end outer catch
} // ⬅︎ end export async function POST(...)
