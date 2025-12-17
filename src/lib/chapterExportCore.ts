// src/lib/chapterExportCore.ts
/* eslint-disable */

import { getOpenAI, getOpenAIModel } from "./openai";
import { generateDiagramImage } from "./imageGen";
import { marked } from "marked";
import htmlToDocx from "html-to-docx";
import puppeteer from "puppeteer-core";              // 👈 CHANGED
import { PDFDocument as PDFLibDoc } from "pdf-lib";
import { promises as fs } from "fs";
import path from "path";
import fontkit from "@pdf-lib/fontkit";
import { Document, Paragraph, Packer } from "docx";



// NOTE: This file must stay “core only” – no NextResponse, no Dynamo, no routes.

export type ExportFormat = "pdf" | "docx" | "md" | "html";



export type ChapterJobInput = {
  subject: string;
  ageRange: string;
  passion: string;
  passionLikes: string[];
  chapterTitle: string;
  weekNum: number;
  format: "pdf" | "docx" | "md" | "html";
  spacious: boolean;
  debugMode: boolean;
  docxRawFlag: boolean;
  rawPdfFlag: boolean;
  userEmail: string;

  /** Optional: prompts we used to generate figures */
  figurePrompts?: string[];

  /** Optional: direct URLs (or data: URLs) to up to 2 generated images */
  figureImageUrls?: string[];
};


marked.setOptions({ gfm: true, breaks: false });

const FONT_PATH = path.join(
  process.cwd(),
  "public",
  "fonts",
  "NotoSans-Regular.ttf"
);

// 👇 NEW: chromium path for puppeteer-core
const CHROME_PATH =
  process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/chromium";

// ---------- filename helper ----------
export function sanitizeFilename(name: string) {
  return name
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .slice(0, 80);
}



// Add near top of chapterExportCore.ts
function appendFiguresMarkdown(
  baseMd: string,
  figureImageUrls?: string[]
): string {
  if (!figureImageUrls || figureImageUrls.length === 0) {
    return baseMd;
  }

  let md = baseMd.trimEnd() + "\n\n## Figures\n\n";

  figureImageUrls.forEach((url, idx) => {
    if (!url) return;
    const n = idx + 1;
    md += `![Figure ${n}](${url})\n\n`;
  });

  return md;
}


// ---------- DOCX helpers ----------
async function buildDocxBufferPlainText(title: string, text: string) {
  const paragraphs = (text || "")
    .split(/\r?\n/)
    .map((line) => new Paragraph(line));

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [new Paragraph(title), ...paragraphs],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

async function buildDocxBufferFromHtml(html: string): Promise<Buffer> {
  const buf = await htmlToDocx(html, null, {
    table: { row: { cantSplit: true } },
    footer: true,
  });
  return buf as Buffer;
}

// ---------- PDF helpers ----------
async function buildPdfBufferPlainText(title: string, text: string) {
  const pdfDoc = await PDFLibDoc.create();
  pdfDoc.registerFontkit(fontkit);

  const raw = await fs.readFile(FONT_PATH);
  const fontBytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const bodyFont = await pdfDoc.embedFont(fontBytes, { subset: false });
  const titleFont = bodyFont;

  let page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  const margin = 54;
  const bodySize = 12;
  const titleSize = 18;
  const lineGap = 14;
  const maxWidth = width - margin * 2;
  let y = height - margin;

  // title
  page.drawText(title || "Chapter", {
    x: margin,
    y,
    size: titleSize,
    font: titleFont,
  });
  y -= titleSize + 10;

  const paras = String(text || "").replace(/\r\n/g, "\n").split("\n");
  for (const para of paras) {
    if (!para.trim()) {
      y -= lineGap;
      if (y < margin) {
        page = pdfDoc.addPage();
        y = page.getSize().height - margin;
      }
      continue;
    }

    let remaining = para.trim();
    while (remaining.length) {
      let low = 1;
      let high = remaining.length;
      let fit = 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const w = bodyFont.widthOfTextAtSize(
          remaining.slice(0, mid),
          bodySize
        );
        if (w <= maxWidth) {
          fit = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      let cut = fit;
      if (cut < remaining.length) {
        const lastSpace = remaining.lastIndexOf(" ", cut);
        if (lastSpace > 0) cut = lastSpace;
      }

      const line = remaining.slice(0, cut).trimEnd();
      page.drawText(line, {
        x: margin,
        y,
        size: bodySize,
        font: bodyFont,
      });
      y -= lineGap;

      if (y < margin) {
        page = pdfDoc.addPage();
        y = page.getSize().height - margin;
      }

      remaining = remaining.slice(cut).trimStart();
    }

    y -= Math.floor(lineGap / 2);
    if (y < margin) {
      page = pdfDoc.addPage();
      y = page.getSize().height - margin;
    }
  }

  return await pdfDoc.save();
}

// 🔥 NEW IMPLEMENTATION (replaces old one)
// uses puppeteer-core + CHROME_PATH + safer waitUntil/timeout
// Pick Chrome path based on env + platform
function getChromeExecutablePath() {
  // allow override (best for local dev + prod)
  if (process.env.CHROME_EXECUTABLE_PATH) return process.env.CHROME_EXECUTABLE_PATH;

  // macOS (common local dev path)
  if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }

  // linux (containers / App Runner)
  return "/usr/bin/chromium";
}

async function buildPdfBufferFromHtml(html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch({
    executablePath: getChromeExecutablePath(),
    headless: true, // ✅ boolean
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-dev-tools",
      "--no-zygote",
      "--single-process",
    ],
  });

  try {
    const page = await browser.newPage();

    // Optional: block most network requests – HTML is already local
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      if (req.resourceType() === "document") req.continue();
      else req.abort();
    });

    await page.setContent(html, {
      waitUntil: "domcontentloaded", // 👈 avoids networkidle hangs
      timeout: 120_000,
    });

    const pdfBuffer = await page.pdf({
      printBackground: true,
      format: "A4",
      margin: {
        top: "0.5in",
        right: "0.5in",
        bottom: "0.5in",
        left: "0.5in",
      },
    });

    return pdfBuffer instanceof Uint8Array ? pdfBuffer : new Uint8Array(pdfBuffer);
  } finally {
    await browser.close();
  }
}


// ---------- markdown -> HTML ----------
function mdToHtml(
  markdown: string,
  title = "Chapter",
  opts?: { spacious?: boolean }
) {
  const body = marked.parse(markdown);

  const base = opts?.spacious
    ? `
      body {
        font-family: system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans", Arial, sans-serif;
        font-size: 13.25pt;
        line-height: 1.6;
        margin: 60px;
      }
      h1 { font-size: 2rem; }
      h2 { font-size: 1.6rem; }
      h3 { font-size: 1.3rem; }
    `
    : `
      body {
        font-family: system-ui, -apple-system, Segoe UI, Roboto, "Noto Sans", Arial, sans-serif;
        font-size: 12pt;
        line-height: 1.5;
        margin: 48px;
      }
      h1 { font-size: 1.9rem; }
      h2 { font-size: 1.5rem; }
      h3 { font-size: 1.25rem; }
    `;

  const paginationCss = `
    h2 {
      page-break-before: always;
      break-before: page;
    }
    h2:first-of-type {
      page-break-before: auto;
      break-before: auto;
    }
    .pagebreak {
      page-break-after: always;
      break-after: page;
    }
    figure,
    img,
    table {
      page-break-inside: avoid;
      break-inside: avoid;
    }
  `;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title.replace(/</g, "&lt;")}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    ${base}
    h1, h2, h3 { line-height: 1.25; margin-top: 1.2em; }
    p, li { font-size: 1rem; }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    pre {
      background: #fafafa;
      padding: 12px;
      overflow: auto;
      border-radius: 6px;
    }
    blockquote {
      border-left: 4px solid #ddd;
      margin: 1em 0;
      padding-left: 1em;
      color: #555;
    }
    table {
      border-collapse: collapse;
      margin: 1em 0;
      width: 100%;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px;
    }
    img {
      max-width: 100%;
      height: auto;
    }
    @page { margin: 36pt; }
    ${paginationCss}
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

// ---------- CrossRef lookup ----------
async function verifyCitationWithCrossRef(author: string, year: string) {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.author", author);
  url.searchParams.set("rows", "3");

  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "aos-aiccs/1.0 (mailto:you@example.com)" },
    });
    if (!res.ok) {
      return { ok: false, match: null };
    }
    const data: any = await res.json();
    const items: any[] = data?.message?.items || [];

    const wantedYear = Number(year);
    const found = items.find((it) => {
      const issued = it?.issued?.["date-parts"];
      const itemYear =
        Array.isArray(issued) && issued[0] && issued[0][0]
          ? Number(issued[0][0])
          : NaN;
      return !Number.isNaN(itemYear) && Math.abs(itemYear - wantedYear) <= 1;
    });

    if (found) {
      return {
        ok: true,
        match: {
          title: Array.isArray(found.title) ? found.title[0] : found.title,
          doi: found.DOI,
          year: found?.issued?.["date-parts"]?.[0]?.[0] ?? year,
        },
      };
    }

    return { ok: false, match: null };
  } catch (err) {
    console.warn("[crossref] lookup failed:", err);
    return { ok: false, match: null };
  }
}

// ---------- Simple chapter prompt ----------
// src/lib/chapterExportCore.ts (or wherever this lives)
function buildSimpleChapterPrompt(p: {
  subject: string;
  ageRange: string;
  chapterTitle: string;
  passion: string;
  passionLikes: string[];
}) {
  const likesText = (p.passionLikes || []).join(", ");

  return [
    `You are an educator who writes rich, age-appropriate instructional chapters.`,
    ``,
    `Write a full teaching chapter for a learner in the age range "${p.ageRange}".`,
    `Main subject/topic: "${p.subject}".`,
    `Chapter title: "${p.chapterTitle}".`,
    ``,
    `The learner really cares about "${p.passion}".`,
    likesText
      ? `They especially like: ${likesText}. Use those details in your examples, stories, numbers, and situations.`
      : `Use "${p.passion}" in every example, story, number, and situation.`,
    ``,
    `OUTPUT FORMAT (Markdown only):`,
    ``,
    `# 1. Why This Matters`,
    `Explain in 5–6 full paragraphs why this topic matters in real life to someone who loves ${p.passion}. Talk directly to the learner.`,
    ``,
    `# 2. Core Ideas`,
    `Write at least 4 MAJOR sections here (use "##" for each).`,
    `Each section must be 4–5 full paragraphs long. In every section, include these bold labels in order:`,
    `**Definition:**`,
    `**How it Works:**`,
    `**Real Example (${p.passion}):**`,
    `**Try It:**`,
    ``,
    `After all sections, add "Common Mistakes" (bullet list with what goes wrong and how to fix it).`,
    ``,
    `# 3. Mini Project`,
    `Describe ONE hands-on project for 2–3 days. Explain goal, materials, steps, how to judge success. Write ~5 paragraphs.`,
    ``,
    `# 4. Practice Questions`,
    `Write 10 practice questions. For each: scenario using ${p.passion}, question, then "Answer:" with a step-by-step explanation.`,
    ``,
    `# 5. Why This Matters For You`,
    `Write 5–6 paragraphs connecting this topic to safety, money/career, respect/skill inside ${p.passion}, and long-term control over their own life.`,
    ``,
    `Also include a final "References" section in APA style with 5–7 credible sources. Use (Author, Year) style citations in the text.`,
    ``,
    `INLINE FIGURE RULES (CRITICAL):`,
    `- You MUST include **at least two** inline images inside the body of the chapter.`,
    `- Each image MUST use EXACTLY this Markdown pattern (including capitalization and punctuation):`,
    `  ![Figure 1](GENERATE: description of the first diagram)`,
    `  ![Figure 2](GENERATE: description of the second diagram)`,
    `- The word "GENERATE" must be UPPERCASE, followed immediately by a colon ":" inside the parentheses.`,
    `- There must be no other tokens inside the parentheses besides "GENERATE:" and the natural-language description.`,
    `- Place each figure immediately after the paragraph that it helps explain (do NOT collect them in a separate "Figures" section).`,
    `- The description should clearly state what the diagram should show (axes, labels, objects, etc.).`,
    ``,
    `STYLE RULES:`,
    `- Write slowly and in depth, not fluffy hype.`,
    `- Use real numbers, speeds, times, costs, etc.`,
    `- Talk directly to the learner with respect.`,
    `- Output ONLY valid Markdown. No JSON. No backticks. No "as an AI".`,
  ].join("\n");
}


// ======================================================================
// CORE: build bytes + filename (no HTTP)
// ======================================================================
export async function generateChapterExportCore(
  input: ChapterJobInput
): Promise<{ fileBytes: Uint8Array; baseName: string; format: ExportFormat }> {
  const {
    subject,
    ageRange,
    passion,
    passionLikes,
    chapterTitle,
    weekNum,
    format,
    spacious,
    docxRawFlag,
    // rawPdfFlag,  // currently unused; reserved for future
  } = input;

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing on server");
  }

  const openai = getOpenAI();
  const model = getOpenAIModel();

  const prompt = buildSimpleChapterPrompt({
    subject,
    ageRange,
    chapterTitle,
    passion,
    passionLikes,
  });

  const aiResponse = await openai.responses.create({
    model,
    input: [
      {
        role: "system",
        content:
          "You are a helpful educator. Respond ONLY in valid Markdown, no JSON, no backticks.",
      },
      { role: "user", content: prompt },
    ],
    reasoning: { effort: "low" },
    text: { verbosity: "high" },
    max_output_tokens: 4000,
  });

  const rawMarkdown = aiResponse.output_text?.trim() || "# (no content)";

  /* ------------------------------------------------------------------
   * 1) Ensure at least 2 inline GENERATE placeholders exist
   * ------------------------------------------------------------------ */

  // Looser, case-insensitive match for (GENERATE: ...)
  const minRegex = /\(\s*GENERATE\s*:\s*([^)]*?)\)/gi;
  const foundImages: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = minRegex.exec(rawMarkdown)) !== null) {
    const desc = (m[1] || "").trim();
    if (desc) foundImages.push(desc);
  }

  let markdownWithMinImages = rawMarkdown;
  if (foundImages.length < 2) {
    const needed = 2 - foundImages.length;
    const extraPlaceholders = [
      '![Figure 1](GENERATE: a clean, high-contrast diagram showing the main concept from this chapter, labeled axes and key parts)',
      '![Figure 2](GENERATE: a simple line or bar chart that illustrates a key numeric example from the chapter, with clear title and axis labels)',
    ];
    markdownWithMinImages +=
      "\n\n" + extraPlaceholders.slice(0, needed).join("\n\n");
  }

  /* ------------------------------------------------------------------
   * 2) Collect all unique GENERATE descriptions we need to render
   * ------------------------------------------------------------------ */

  const genRegex2 = /\(\s*GENERATE\s*:\s*([^)]*?)\)/gi;
  const toGenerate: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = genRegex2.exec(markdownWithMinImages)) !== null) {
    const desc = (match[1] || "").trim();
    if (desc && !toGenerate.includes(desc)) {
      toGenerate.push(desc);
    }
  }

  const MAX_INLINE_IMAGES = 2;
  const urlMap: Record<string, string> = {};

  for (const desc of toGenerate.slice(0, MAX_INLINE_IMAGES)) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const url = await generateDiagramImage(desc);
      console.log("[chapterExportCore] DALL·E image for:", desc, "→", url);
      if (url) {
        urlMap[desc] = url;
      }
    } catch (err: any) {
      console.error(
        "[chapterExportCore] image generation failed:",
        desc,
        err?.message || err
      );
    }
  }

  /* ------------------------------------------------------------------
   * 3) Replace GENERATE placeholders with real URLs (or fallbacks)
   * ------------------------------------------------------------------ */

  let finalMarkdown = markdownWithMinImages.replace(
    /\]\(\s*GENERATE\s*:\s*([^)]*?)\)/gi,
    (_full, rawDesc) => {
      const key = String(rawDesc || "").trim();
      const got = urlMap[key];
      // If we got a real URL, use it; otherwise, leave the description visible
      return got ? `](${got})` : `](${key})`;
    }
  );

  /* ------------------------------------------------------------------
   * 4) References + optional citation verification (unchanged)
   * ------------------------------------------------------------------ */

  // References section (basic presence check)
  const hasReferences =
    /(^|\n)#{1,6}\s*references\b/i.test(finalMarkdown) ||
    /(^|\n)references\s*:/i.test(finalMarkdown);

  if (!hasReferences) {
    finalMarkdown += `

## References
This chapter was generated by an AI content system using general educational knowledge. No specific external sources were cited in this draft.
`;
  }

  // REAL CITATION VERIFICATION (CrossRef)
  const citationMatches = Array.from(
    finalMarkdown.matchAll(/\(([A-Z][A-Za-z'’-]+),\s*(20\d{2})\)/g)
  );

  const uniqueCitations = Array.from(
    new Map(
      citationMatches.map((mm) => {
        const author = mm[1];
        const year = mm[2];
        return [`${author}|${year}`, { author, year }];
      })
    ).values()
  );

  if (uniqueCitations.length > 0) {
    const verified: Array<{
      author: string;
      year: string;
      ok: boolean;
      match?: any;
    }> = [];

    for (const { author, year } of uniqueCitations) {
      // eslint-disable-next-line no-await-in-loop
      const res = await verifyCitationWithCrossRef(author, year);
      verified.push({ author, year, ok: res.ok, match: res.match });
    }

    finalMarkdown += `

## Reference Verification
The following in-text citations were checked against CrossRef at build time:

${verified
  .map((v) =>
    v.ok
      ? `- ✅ (${v.author}, ${v.year}) — found${
          v.match?.doi ? ` DOI: ${v.match.doi}` : ""
        }`
      : `- ⚠️ (${v.author}, ${v.year}) — no close match found on CrossRef`
  )
  .join("\n")}
`;
  } else {
    if (
      !/(^|\n)#{1,6}\s*references\b/i.test(finalMarkdown) &&
      !/(^|\n)references\s*:/i.test(finalMarkdown)
    ) {
      finalMarkdown += `

## References
This chapter was generated by an AI content system using general educational knowledge. No specific external sources were cited in this draft.
`;
    }
  }

  /* ------------------------------------------------------------------
   * 5) Convert to HTML / bytes (unchanged)
   * ------------------------------------------------------------------ */

  const html = mdToHtml(finalMarkdown, chapterTitle, { spacious });

  const baseName = sanitizeFilename(
    `chapter_week${weekNum}_${chapterTitle || "Untitled"}`
  );

  let fileBytes: Uint8Array;

  if (format === "docx") {
    const buf: Buffer | Uint8Array = docxRawFlag
      ? await buildDocxBufferPlainText(chapterTitle, finalMarkdown)
      : await buildDocxBufferFromHtml(html);

    fileBytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  } else if (format === "pdf") {
    fileBytes = await buildPdfBufferFromHtml(html);
  } else if (format === "html") {
    fileBytes = new TextEncoder().encode(html);
  } else {
    // markdown
    fileBytes = new TextEncoder().encode(finalMarkdown);
  }

  return { fileBytes, baseName, format };
}



// simple helper for S3 content-type
export function getContentType(format: ExportFormat): string {
  switch (format) {
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "html":
      return "text/html; charset=utf-8";
    case "md":
    default:
      return "text/markdown; charset=utf-8";
  }
}
