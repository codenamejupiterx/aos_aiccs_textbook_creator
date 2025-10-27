// src/app/api/passions/[id]/weeks/[week]/chapter/route.ts
/* eslint-disable */
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getItemByUserEntity } from "@/lib/dynamo";
import { getOpenAI } from "@/lib/openai";
import type { Output, WeekItem, Week1Chapter, Reference } from "@/types/aiccs";
import { z } from "zod";
import { OutputSchema as StrictOutputSchema } from "@/lib/aiccs-schema";








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



/** Accept proper URLs or drop them; prevents zod “Invalid url” failures */
const UrlLoose = z
  .string()
  .trim()
  .optional()
  .transform(v => (v && v.length ? v : undefined))
  .refine(v => v === undefined || /^https?:\/\/\S+/i.test(v), { message: "Invalid url" });

const LooseReference = z.object({
  type: z.enum(["web","book","article","report"]).optional(),
  title: z.string().trim().optional(),
  author: z.string().trim().optional(),
  year: z.string().trim().optional(),
  publisher: z.string().trim().optional(),
  url: UrlLoose.optional(),
});

/** Map common alias keys the model may return → your exact schema keys */
function normalizeModelJson(raw: any) {
  const out: any = {};
  out.curriculum16 =
    raw?.curriculum16 ?? raw?.curriculum ?? raw?.weeks ?? raw?.plan ?? [];

  out.week1Chapter =
    raw?.week1Chapter ??
    raw?.chapter ??
    raw?.week_one_chapter ??
    raw?.week1 ??
    raw?.week_1 ??
    null;

  // Clean references if present
  if (out.week1Chapter?.references) {
    try {
      const cleaned = z.array(LooseReference).parse(out.week1Chapter.references);
      out.week1Chapter.references = cleaned.filter(
        r => (r.title && r.title.length >= 2) || r.url
      );
    } catch {
      out.week1Chapter.references = [];
    }
  }
  return out;
}


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

function buildJsonPrompt(p: {
  subject: string;
  ageRange: string;
  passion: string;
  chapterTitle: string;
  passionLikes: string[] | string;
  notes?: string;
  targetWords?: number;     // e.g., 1800
  minSections?: number;     // e.g., 6
  minRefs?: number;         // e.g., 3
}) {
  const likesJson = Array.isArray(p.passionLikes)
    ? JSON.stringify(p.passionLikes)
    : JSON.stringify([p.passionLikes].filter(Boolean));
  const notes = (p.notes ?? "").trim() || "(none)";
  const targetWords = p.targetWords ?? 1800;
  const minSections = p.minSections ?? 6;
  const minRefs = p.minRefs ?? 3;

  return `
Create a 16-week curriculum plan and a long-form Week 1 chapter in STRICT JSON.

Subject: ${p.subject}
Age range: ${p.ageRange}
Theme: "${p.passion}"
Learner likes (verbatim JSON): ${likesJson}
Notes: ${notes}

### OUTPUT SCHEMA (return STRICT, MINIFIED JSON ONLY)
{
  "curriculum16":[
    {"week":1,"title":"","goals":["",""],"topics":["",""],"activity":"","assessment":""}
    // ... weeks 2–16, same shape
  ],
  "week1Chapter":{
    "title":"",
    "abstract":"",
    "sections":[
      {"heading":"","body":""},
      {"heading":"","body":""}
    ],
    "figures":[{"label":"Figure 1","caption":"","suggested_visual":""}],
    "citations_style":"APA",
    "intext_citations":true,
    "references":[
      {"type":"web|book|article|report","title":"","author":"","year":"","publisher":"","url":""}
    ],
    "ai_generated":false,
    "estimated_word_count":${targetWords}
  }
}

### CONTENT REQUIREMENTS (WEEK 1 CHAPTER)
- Target total words: ~${targetWords} (NOT less than ${Math.floor(targetWords*0.85)}).
- Sections: ${minSections}–8 sections. Use this skeleton (rename headings as needed):
  1) Background & Significance,
  2) Core Concepts & Definitions (with formulas or key terms where relevant),
  3) Historical or Cultural Context (tie to ${p.passion}),
  4) Applied Case Study tied to the learner’s passion (rigorous, step-by-step),
  5) Practice & Worked Examples (at least 2 multi-step examples),
  6) Assessment & Reflection (10 varied questions + brief answer key).
- Depth:
  - Each section body should be ≥ ${Math.max(200, Math.floor(targetWords/(minSections+1)))} words.
  - When making claims or using data, include in-text citations (Author, Year).
  - References must be REALISTIC and verifiable. Prefer reputable books/articles/web from museums, universities, journals, standards bodies.
  - If adequate sources are unavailable, set "ai_generated": true and leave "references":[].
- Style:
  - Age-appropriate, but rigorous. Define jargon and show at least one equation or formal definition if applicable to ${p.subject}.
  - Use complete paragraphs in "sections" (NO bullet lists inside "sections").
- Curriculum (weeks 1–16): Each week includes 2–4 measurable goals, 2–5 topics, one hands-on activity, and a quick assessment.

### VALIDATION
- Return ONLY minified JSON (no markdown, no prose, no comments).
- "curriculum16" must contain exactly 16 items with week=1..16 and unique titles.
`.trim();
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

function renderChapterMarkdown(ch: Week1Chapter): string {
  const lines: string[] = [];
  lines.push(`# ${ch.title}`);
  if (ch.abstract) lines.push("", `**Abstract** — ${ch.abstract}`);

  for (const sec of ch.sections) {
    lines.push("", `## ${sec.heading}`, "", sec.body);
  }

  if (ch.figures?.length) {
    lines.push("", "## Figures");
    for (const f of ch.figures) {
      lines.push(`- **${f.label}**: ${f.caption} _(suggested: ${f.suggested_visual})_`);
    }
  }

  if (ch.references?.length) {
    lines.push("", "## References");
    for (const r of ch.references) {
      const base = `- ${r.author} (${r.year}). *${r.title}*${r.publisher ? `. ${r.publisher}` : ""}`;
      lines.push(r.url ? `${base}. ${r.url}` : base);
    }
  } else if (ch.ai_generated) {
    lines.push("", "_Note: AI Generated (no external sources cited)._");
  }

  return lines.join("\n");
}

function countWords(s: string): number {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}

function chapterWordCount(ch: Week1Chapter): number {
  let n = countWords(ch.title) + countWords(ch.abstract || "");
  for (const sec of ch.sections || []) n += countWords(sec.body || "") + countWords(sec.heading || "");
  for (const fig of ch.figures || []) n += countWords(fig.caption || "") + countWords(fig.suggested_visual || "");
  return n;
}

type DepthPolicy = {
  minSections: number;
  minWordsTotal: number;
  minWordsPerSection: number;
  minReferences: number;       // set to 0 to allow AI-generated with no refs
  citationsRequired: boolean;  // if true, intext_citations must be true when references exist
};

type ChapterReq = { title: string };


function assessDepth(ch: Output["week1Chapter"], p: DepthPolicy) {
  const words = (ch.sections?.map(s => s.body).join(" ") || "").trim().split(/\s+/).length;
  const perSectionOk = ch.sections?.every(s => (s.body.split(/\s+/).length >= p.minWordsPerSection)) ?? false;
  const refs = ch.references?.length ?? 0;
  const issues: string[] = [];
  if (!ch.sections || ch.sections.length < p.minSections) issues.push(`Need ≥ ${p.minSections} sections`);
  if (words < p.minWordsTotal) issues.push(`Need ≥ ${p.minWordsTotal} words (have ~${words})`);
  if (!perSectionOk) issues.push(`Each section must have ≥ ${p.minWordsPerSection} words`);
  if (p.citationsRequired && refs < p.minReferences && !ch.ai_generated)
    issues.push(`Need ≥ ${p.minReferences} references or set ai_generated:true`);
  return { ok: issues.length === 0, issues };
}



function normalizeUrl(u: unknown): string | null {
  const raw = String(u ?? "").trim();
  if (!raw) return null;

  // If already absolute http(s), keep it
  if (/^https?:\/\//i.test(raw)) {
    try { new URL(raw); return raw; } catch { return null; }
  }

  // If it looks like a domain/path, prefix https://
  if (/^[\w.-]+\.[a-z]{2,}([/:?#].*)?$/i.test(raw)) {
    const prefixed = "https://" + raw;
    try { new URL(prefixed); return prefixed; } catch { /* fall through */ }
  }

  // Last chance: let URL decide (will throw on garbage)
  try { new URL(raw); return raw; } catch { return null; }
}

function scrubReferences(obj: any): void {
  const refs = obj?.week1Chapter?.references;
  if (!Array.isArray(refs)) return;

  const okTypes = new Set(["web", "book", "article", "report"]);
  obj.week1Chapter.references = refs
    .filter(Boolean)
    .map((r: any) => {
      const copy: any = { ...r };
      if (!okTypes.has(copy.type)) copy.type = "web";

      if ("url" in copy) {
        const norm = normalizeUrl(copy.url);
        if (!norm) delete copy.url; else copy.url = norm;
      }
      return copy;
    });

  // If after scrubbing we have zero usable refs, flip the flag
  if ((obj.week1Chapter.references?.length ?? 0) === 0) {
    obj.week1Chapter.ai_generated = true;
  }
}




// POST /api/passions/[id]/weeks/[week]/chapter?format=pdf|docx&debug=1&dryrun=1
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; week: string }> } // 👈 params is a Promise
) {
  const { id, week } = await ctx.params; 
  const url = new URL(req.url);
  const debugMode = url.searchParams.get("debug") === "1";
  const dryrun = url.searchParams.get("dryrun") === "1";
  const format = (url.searchParams.get("format") || "pdf").toLowerCase() as "pdf" | "docx" | "md";

  let data: Output | null = null;
  let issues: string[] = [];
  let attempt = 0;

  try {
    // 1) Auth
    const session = await auth();
    const email = (session?.user as any)?.email as string | undefined;
    if (!email) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    // 2) Params & body
    const rawId = decodeURIComponent(id || "");
    const weekNum = Number(week || "0");
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

  
   // 6) OpenAI generation → strict JSON → validate → render Markdown
const systemMsg =
  "You are an expert educator and instructional designer. Return ONLY valid, minified JSON matching the schema. No prose/markdown/comments/trailing commas. If no verifiable sources used, set ai_generated:true and references:[].";

const policy: DepthPolicy = {
  minSections: 6,
  minWordsTotal: 1700,
  minWordsPerSection: 220,
  minReferences: 3,
  citationsRequired: true,
};

const openai = getOpenAI();
if (!process.env.OPENAI_API_KEY) {
  return NextResponse.json({ ok: false, error: "OPENAI_API_KEY missing on server" }, { status: 500 });
}

const model = process.env.OPENAI_MODEL || process.env.OPENAI_TEXT_MODEL || "gpt-4o-mini";

// ---- request helper (makes one JSON attempt) ----
async function requestOnce(instructionOverride?: string): Promise<Output> {
  const userMsg = instructionOverride
    ? instructionOverride
    : buildJsonPrompt({
        subject: subject_var,
        ageRange: ageRange_var,
        passion: passion_var,
        chapterTitle,
        passionLikes: passionLikes_var,
        notes: passion.notes || "",
        targetWords: 1800,
        minSections: 6,
        minRefs: 3,
      });

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.35,
    max_tokens: 6000,                        // give it room
    response_format: { type: "json_object" },// force JSON
    messages: [
      { role: "system", content: systemMsg },
      { role: "user", content: userMsg },
    ],
  });

  const content = completion.choices?.[0]?.message?.content || "{}";

  // 1) parse raw JSON from the model
  let raw: any;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    // If it somehow ignored response_format, force a failure so we refine
    throw new Error("model_not_json");
  }

  // 2) normalize common alias keys + clean references
  const normalized = normalizeModelJson(raw);

  // 3) strict validate against your OutputSchema
  const result = StrictOutputSchema.safeParse(normalized);
  if (!result.success) {
    // Surface schema details when debug=1
    if (debugMode) {
      throw new Error("Schema validation failed: " + JSON.stringify(result.error.format()));
    }
    throw new Error("model_json_invalid");
  }
  return result.data;
}

try {
  // attempt 1
  attempt = 1;
  data = await requestOnce();

  // assess depth
  let check = assessDepth(data.week1Chapter, policy);
  if (!check.ok) {
    issues = check.issues;

    // attempt 2
    attempt = 2;
    const refine = `
You previously returned JSON for the chapter, but it needs deepening.
Fix ONLY the fields that need more depth and return the FULL JSON object again, minified.

Deficits:
${issues.map(s => `- ${s}`).join("\n")}

Rules:
- Keep the same schema and keys.
- Expand "sections" where needed. Add more sections if necessary (max 8).
- Provide at least ${policy.minReferences} solid references unless you must set "ai_generated": true.
- Maintain age-appropriateness and ${subject_var} rigor.

Return only the full, minified JSON object.`;
    data = await requestOnce(refine);

    // re-assess
    check = assessDepth(data.week1Chapter, policy);
    if (!check.ok) {
      issues = check.issues;

      // attempt 3
      attempt = 3;
      const refine2 = `
Deepen further and fix remaining deficits. Return full, minified JSON.

Remaining deficits:
${issues.map(s => `- ${s}`).join("\n")}

Hard requirements:
- ≥ ${policy.minSections} sections.
- ≥ ${policy.minWordsTotal} total words and ≥ ${policy.minWordsPerSection} words per section.
- ≥ ${policy.minReferences} references unless "ai_generated": true with "references":[].
- In-text citations true if references exist.

Return only the JSON.`;
      data = await requestOnce(refine2);

      check = assessDepth(data.week1Chapter, policy);
      if (!check.ok && debugMode) {
        return NextResponse.json({ ok: false, where: "depth", attempt, issues: check.issues }, { status: 422 });
      }
    }
  }
} catch (err: any) {
  // One last “auto-clean” fallback: try to normalize whatever came back (if anything),
  // mark AI-generated, strip bad references, then validate. If that still fails, bubble up.
  try {
    const last = (err?.message || "").includes("{")
      ? JSON.parse(err.message) // not typical, but just in case you threw raw json
      : null;
    if (last) {
      const normalized = normalizeModelJson(last);
      if (normalized?.week1Chapter) {
        normalized.week1Chapter.ai_generated = true;
        normalized.week1Chapter.references = [];
      }
      const ok = StrictOutputSchema.safeParse(normalized);
      if (ok.success) data = ok.data as Output;
    }
  } catch { /* ignore */ }

  if (!data) {
    if (debugMode) {
      return NextResponse.json(
        { ok: false, where: "openai_or_parse", attempt, error: String(err?.message || err) },
        { status: 500 }
      );
    }
    throw err;
  }
}

// ---- Render & export ----
const chapterMd = renderChapterMarkdown(data.week1Chapter);
const baseName = sanitizeFilename(
  `chapter_week${weekNum}_${data.week1Chapter.title || chapterTitle || "Untitled"}`
);

if (format === "docx") {
  const buf = await buildDocxBuffer(data.week1Chapter.title || `Week ${weekNum} Chapter`, chapterMd);
  const bytes = new Uint8Array(buf);
  const stream = new ReadableStream({ start(c){ c.enqueue(bytes); c.close(); } });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${baseName}.docx"`,
      "Cache-Control": "no-store",
    },
  });
}

if (format === "pdf") {
  const buf = await buildPdfBuffer(data.week1Chapter.title || `Week ${weekNum} Chapter`, chapterMd);
  const bytes = new Uint8Array(buf);
  const stream = new ReadableStream({ start(c){ c.enqueue(bytes); c.close(); } });
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

// Markdown fallback
return new Response(chapterMd, {
  status: 200,
  headers: {
    "Content-Type": "text/markdown; charset=utf-8",
    "Content-Disposition": `attachment; filename="${baseName}.md"`,
    "Cache-Control": "no-store",
  }
});

// return new Response(content, {
//   status: 200,
//   headers: {
//     "Content-Type": "text/markdown; charset=utf-8",
//     "Content-Disposition": `attachment; filename="${baseName}.md"`,
//     "Cache-Control": "no-store",
//   },
// });
} catch (e: any) {
  // ⬅︎ closes the OUTER try { … } that began earlier in POST
  const safe = String(e?.message || e);
  const payload: any = { ok: false, error: "server_error", message: safe };
  if (debugMode) payload.stack = e?.stack;
  console.error("[chapter route] 500:", safe, e?.stack);
  return NextResponse.json(payload, { status: 500 });
} // ⬅︎ end outer catch
} // ⬅︎ end export async function POST(...)
