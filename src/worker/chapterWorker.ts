// src/worker/chapterWorker.ts
/* eslint-disable */
console.log("[chapterWorker] BUILD MARKER 2025-11-21-0530");

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import crypto from "crypto";

import {
  generateChapterExportCore,
  type ChapterJobInput,
  getContentType,
  sanitizeFilename,
} from "../lib/chapterExportCore";

import { putText } from "../lib/s3";
import { getOpenAI } from "../lib/openai";
import { generateDiagramImage } from "../lib/imageGen"; // 🔹 NEW

import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DDB_TABLE;
if (!TABLE) {
  throw new Error("DDB_TABLE env var is required for chapterWorker");
}
const ddb = new DynamoDBClient({ region: REGION });

const BUCKET = process.env.BUCKET || process.env.AWS_S3_BUCKET || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5";

/* ------------------------------------------------------------------ */
/* Helpers shared with /api/generate (local fallback curriculum/text) */
/* ------------------------------------------------------------------ */

const MAX_ITEMS = 20;
const MAX_LEN = 40;

function buildLocalCurriculum(subject: string, passion: string, likes: string[]) {
  const weeks = Array.from({ length: 16 }, (_, i) => i + 1);
  return weeks.map((w) => ({
    week: w,
    title: `${subject} × ${passion}: Week ${w}`,
    goals: [
      `Advance ${subject} skills with a ${passion}-themed activity`,
      `Practice key problem types for Week ${w}`,
      `Connect concepts to real examples${
        likes?.length ? ` (${likes.slice(0, 2).join(", ")})` : ""
      }`,
    ],
    topics: [`${subject} topic set ${w}`, `Applied example using ${passion}`],
    activity: `Hands-on: mini task using ${passion} context (Week ${w}).`,
    assessment: `Quick check-for-understanding for Week ${w}.`,
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

  return {
    title: `Week 1 — ${subject} via ${passion} (${ageRange})`,
    body,
  };
}

/* --------------------------------------------------------- */
/* bgTestJob helpers (these handle the new background queue) */
/* --------------------------------------------------------- */

function parseBgInput(item: any): {
  subject: string;
  passion: string;
  ageRange: string;
  notes: string;
  passionLikes: string[];
} {
  let raw: any = null;

  // preferred: JSON string in item.input.S
  if (item.input?.S) {
    try {
      raw = JSON.parse(item.input.S);
    } catch {
      raw = null;
    }
  } else if (item.input?.M) {
    // map-style storage fallback
    const m = item.input.M;
    raw = {
      subject: m.subject?.S ?? "",
      passion: m.passion?.S ?? "",
      ageRange: m.ageRange?.S ?? "",
      notes: m.notes?.S ?? "",
      passionLikes: Array.isArray(m.passionLikes?.L)
        ? m.passionLikes.L.map((v: any) => v.S ?? "").filter(Boolean)
        : [],
    };
  }

  if (!raw) {
    throw new Error("bgTestJob missing or invalid input");
  }

  return {
    subject: String(raw.subject ?? "").trim(),
    passion: String(raw.passion ?? "").trim(),
    ageRange: String(raw.ageRange ?? "").trim(),
    notes: String(raw.notes ?? "").trim(),
    passionLikes: Array.isArray(raw.passionLikes)
      ? raw.passionLikes.map((x: any) => String(x)).filter(Boolean)
      : [],
  };
}

async function findPendingBgTestJob() {
  if (!TABLE) return null;

  const out = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      Limit: 1,
      FilterExpression: "#type = :t AND #status = :s",
      ExpressionAttributeNames: {
        "#type": "type",
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":t": { S: "bgTestJob" },
        ":s": { S: "pending" },
      },
    })
  );

  const item = out.Items && out.Items[0];
  return item || null;
}

async function processBgTestJob(item: any) {
  const email = item.userId?.S || "";
  const jobId = item.jobId?.S || "";
  if (!email || !jobId) {
    console.warn("[bgTestJob] missing email or jobId, skipping");
    return;
  }

  const { subject, passion, ageRange, notes, passionLikes } = parseBgInput(item);

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

  console.log(
    `[bgTestJob] processing job ${jobId} for ${email} (subject=${subject}, passion=${passion})`
  );

  let curriculum16: any[] | null = null;
  let week1Chapter: { title: string; body: string } | null = null;

  try {
    const openai = getOpenAI();
    const sys =
      "You are an expert educator and instructional designer. You must return ONLY valid, minified JSON that conforms exactly to the provided schema. Do not include prose, markdown, comments, or trailing commas. If you cite sources, they must be verifiable (books, articles, reputable websites); if no sources were used, mark the chapter as AI-generated per the schema.";
    const userPrompt = `
Create a 16-week curriculum plan and a long-form Week 1 chapter.

Subject: ${subject}
Age range: ${ageRange}
Theme: "${passion}"
Learner likes (verbatim JSON): ${JSON.stringify(passionLikes)}
Teacher/learner notes: ${notes || "(none)"}

### OUTPUT SCHEMA (return STRICT JSON matching this)
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
      {"heading": "", "body": ""},
      {"heading": "", "body": ""}
    ],
    "figures": [
      {"label": "Figure 1", "caption": "", "suggested_visual": ""}
    ],
    "citations_style": "APA",
    "intext_citations": true,
    "references": [
      {
        "type": "web|book|article|report",
        "title": "",
        "author": "",
        "year": "",
        "publisher": "",
        "url": ""
      }
    ],
    "ai_generated": false,
    "estimated_word_count": 1400
  }
}

### CONTENT REQUIREMENTS
- Curriculum:
  - 16 items (weeks 1–16). Each must include 2–4 clear, measurable goals, 2–5 topics, one hands-on activity, and a quick assessment.
- Week 1 chapter (research-paper style):
  - 1–2 sentence abstract.
  - 4–6 sections (e.g., Background, Core Concepts, Applied Example tied to the learner’s passion, Practice, Reflection).
  - Use in-text citations where claims or data appear; keep them realistic and checkable.
  - “References” must list the works actually cited. If no solid sources are available, leave "references":[]
    and set "ai_generated": true.
  - Target ~1200–1600 words total; write complete paragraphs, no bullet lists in sections.
- Tone and level:
  - Age-appropriate, inclusive, and encouraging; avoid jargon unless explained.
- Safety and originality:
  - No copyrighted text beyond short quotations (<25 words) with citation.
  - Do NOT fabricate source details. Prefer omitting a reference and setting "ai_generated": true over making one up.

### VALIDATION
- Return ONLY compact JSON (no comments/newlines beyond JSON, no trailing commas).
- Ensure curriculum16 has exactly 16 objects with week=1..16 and unique titles.
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
    console.error("[bgTestJob] OpenAI error, using local fallback:", e);
    curriculum16 = buildLocalCurriculum(subject, passion, passionLikes);
    week1Chapter = buildLocalWeek1(subject, passion, ageRange, passionLikes, notes);
  }

  if (!curriculum16 || !week1Chapter) {
    throw new Error("Generation failed (OpenAI+fallback both empty)");
  }

  if (BUCKET) {
    const curriculumText = JSON.stringify(curriculum16, null, 2);
    const chapterText = `# ${week1Chapter.title || "Week 1"}\n\n${
      week1Chapter.body || ""
    }`;

    await putText(BUCKET, keys.curriculum, curriculumText, "application/json");
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
    console.warn("[bgTestJob] BUCKET not configured; skipping S3 writes");
  }

  // create the passion row (what /api/generate used to do)
  await ddb.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: {
        userId: { S: email },
        entity: { S: entity },
        type: { S: "passion" },
        passionId: { S: passionId },
        subject: { S: subject },
        passion: { S: passion },
        ageRange: { S: ageRange },
        notes: { S: notes },
        passionLikes: {
          L: (passionLikes || []).map((p) => ({ S: String(p) })),
        },
        bucket: { S: BUCKET },
        s3CurriculumKey: { S: keys.curriculum },
        s3ChapterKey: { S: keys.chapter },
        s3MergedKey: { S: keys.merged },
        status: { S: "ready" },
        createdAt: { S: nowIso },
        updatedAt: { S: nowIso },
      },
    })
  );

  // mark job as done + attach passionId
  await ddb.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: {
        userId: { S: email },
        entity: { S: item.entity?.S || `bgTestJob#${jobId}` },
      },
      UpdateExpression:
        "SET #status = :done, #updatedAt = :u, #passionId = :pid",
      ExpressionAttributeNames: {
        "#status": "status",
        "#updatedAt": "updatedAt",
        "#passionId": "passionId",
      },
      ExpressionAttributeValues: {
        ":done": { S: "done" },
        ":u": { S: new Date().toISOString() },
        ":pid": { S: passionId },
      },
    })
  );

  console.log(
    `[bgTestJob] finished job ${jobId}; created passion ${passionId} for ${email}`
  );
}

/* ----------------------------------------------- */
/* Existing chapterJob flow (PDF/DOCX generation) */
/* ----------------------------------------------- */

type ChapterJob = {
  userId: string;
  entity: string; // "chapterJob#<jobId>"
  jobId: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function claimNextPendingChapterJob(): Promise<ChapterJob | null> {
  console.log("[chapterWorker] scanning for pending chapter jobs...");

  const scan = await ddb.send(
    new ScanCommand({
      TableName: TABLE,
      Limit: 25,
      FilterExpression:
        "begins_with(#entity, :prefix) AND #status = :pending",
      ExpressionAttributeNames: {
        "#entity": "entity",
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":prefix": { S: "chapterJob#" },
        ":pending": { S: "pending" },
      },
    })
  );

  const item = (scan.Items ?? [])[0];
  if (!item) {
    console.log("[chapterWorker] no pending job found");
    return null;
  }

  const userId = item.userId?.S;
  const entity = item.entity?.S;
  const status = item.status?.S;
  const jobId = item.jobId?.S;

  if (!userId || !entity || !jobId || status !== "pending") {
    console.warn("[chapterWorker] item missing fields or not pending:", item);
    return null;
  }

  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: {
          userId: { S: userId },
          entity: { S: entity },
        },
        UpdateExpression: "SET #status = :running, #updatedAt = :now",
        ConditionExpression: "#status = :pending",
        ExpressionAttributeNames: {
          "#status": "status",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":pending": { S: "pending" },
          ":running": { S: "running" },
          ":now": { S: new Date().toISOString() },
        },
      })
    );
  } catch (err: any) {
    console.warn(
      "[chapterWorker] failed to claim job (race or already claimed):",
      jobId,
      err?.name
    );
    return null;
  }

  console.log("[chapterWorker] claimed job:", { jobId, userId });
  return { userId, entity, jobId };
}

async function processJob(job: ChapterJob) {
  console.log("[chapterWorker] processing job:", job.jobId);

  const getRes = await ddb.send(
    new GetItemCommand({
      TableName: TABLE,
      Key: {
        userId: { S: job.userId },
        entity: { S: job.entity },
      },
    })
  );

  const item = getRes.Item || {};
  const passionId = item.passionId?.S || "";
  const weekNum = Number(item.weekNum?.N || "1");
  const format = (item.format?.S as any) || "pdf";
  const chapterTitle = item.chapterTitle?.S || `Week ${weekNum} Chapter`;
  const spacious = !!item.spacious?.BOOL;
  const docxRawFlag = !!item.docxRawFlag?.BOOL;
  const rawPdfFlag = !!item.rawPdfFlag?.BOOL;
  const debugMode = !!item.debugMode?.BOOL;

  if (!passionId) {
    await markFailed(job, "Missing passionId on chapter job");
    return;
  }

  const passionEntity = `passion#${passionId}`;
  const passionRes = await ddb.send(
    new GetItemCommand({
      TableName: TABLE,
      Key: {
        userId: { S: job.userId },
        entity: { S: passionEntity },
      },
    })
  );
  const pItem = passionRes.Item || {};

  const subject = pItem.subject?.S || "General Studies";
  const passion = pItem.passion?.S || "Learning";
  const ageRange = pItem.ageRange?.S || "College / Adult";
  const passionLikes =
    pItem.passionLikes?.L?.map((v: any) => v.S || "").filter(Boolean) || [];

  const bucket = process.env.BUCKET || process.env.AWS_S3_BUCKET;
  if (!bucket) {
    await markFailed(job, "Missing BUCKET / AWS_S3_BUCKET env var");
    return;
  }

  const emailSafe = job.userId.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const basePrefix = `textbook/${emailSafe}/${passionId}/week${weekNum}/`;
  const ext = format === "pdf" ? "pdf" : format === "docx" ? "docx" : format;
  const key = `${basePrefix}${sanitizeFilename(
    `chapter_week${weekNum}_${chapterTitle}`
  )}.${ext}`;

  // --- build two image prompts for this chapter ---
  const figurePrompts: string[] = [
    `Educational illustration for ${subject}, Week ${weekNum}, using a ${passion} theme. ` +
      `Age range ${ageRange}. Simple, clear diagram with labels, no text paragraphs.`,

    `Second educational illustration for ${subject}, Week ${weekNum}, again in a ${passion} context. ` +
      `Show a different aspect of the concept. Clean, high-contrast graphic, no text paragraphs.`,
  ];

  const figureImageUrls: string[] = [];

  for (const prompt of figurePrompts) {
    try {
      // use your existing OpenAI image helper
      // eslint-disable-next-line no-await-in-loop
      const url = await generateDiagramImage(prompt);
      if (url) {
        figureImageUrls.push(url);
      } else {
        console.warn(
          "[chapterWorker] image helper returned empty URL for prompt:",
          prompt
        );
      }
    } catch (err: any) {
      console.error(
        "[chapterWorker] figure generation failed:",
        prompt,
        err?.message || err
      );
    }
  }

  const input: ChapterJobInput = {
    subject,
    ageRange,
    passion,
    passionLikes,
    chapterTitle,
    weekNum,
    format,
    spacious,
    debugMode,
    docxRawFlag,
    rawPdfFlag,
    userEmail: job.userId,

    // 🔹 new: give the core exporter the prompt + URLs
    figurePrompts,
    figureImageUrls,
  };

  try {
    const { fileBytes, baseName } = await generateChapterExportCore(input);

    await putText(bucket, key, fileBytes, getContentType(format));

    await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: {
          userId: { S: job.userId },
          entity: { S: job.entity },
        },
        UpdateExpression:
          "SET #status = :done, #outputBucket = :bucket, #outputKey = :key, #filename = :fname, updatedAt = :now",
        ExpressionAttributeNames: {
          "#status": "status",
          "#outputBucket": "outputBucket",
          "#outputKey": "outputKey",
          "#filename": "filename",
        },
        ExpressionAttributeValues: {
          ":done": { S: "done" },
          ":bucket": { S: bucket },
          ":key": { S: key },
          ":fname": { S: `${baseName}.${ext}` },
          ":now": { S: new Date().toISOString() },
        },
      })
    );

    console.log(
      "[chapterWorker] job DONE:",
      job.jobId,
      "->",
      `${bucket}/${key}`
    );
  } catch (err: any) {
    console.error("[chapterWorker] job FAILED:", job.jobId, err);
    await markFailed(job, (err?.message ?? String(err)).slice(0, 500));
  }
}

async function markFailed(job: ChapterJob, msg: string) {
  await ddb.send(
    new UpdateItemCommand({
      TableName: TABLE,
      Key: {
        userId: { S: job.userId },
        entity: { S: job.entity },
      },
      UpdateExpression:
        "SET #status = :failed, #error = :msg, updatedAt = :now",
      ExpressionAttributeNames: {
        "#status": "status",
        "#error": "errorMessage",
      },
      ExpressionAttributeValues: {
        ":failed": { S: "failed" },
        ":msg": { S: msg },
        ":now": { S: new Date().toISOString() },
      },
    })
  );
}

/* --------------------- */
/* main worker loop      */
/* --------------------- */

async function main() {
  console.log("[chapterWorker] starting chapter worker loop...");
  while (true) {
    try {
      // 1) bgTestJob (curriculum + Week 1) takes priority
      const bgJob = await findPendingBgTestJob();
      if (bgJob) {
        console.log(
          "[chapterWorker] found pending bgTestJob:",
          bgJob.jobId?.S || bgJob.entity?.S
        );
        try {
          await processBgTestJob(bgJob);
        } catch (e: any) {
          console.error("[chapterWorker] bgTestJob FAILED:", e);
        }
        continue; // then check again
      }

      // 2) Fall back to existing chapterJob flow
      const job = await claimNextPendingChapterJob();
      if (!job) {
        await sleep(5000);
        continue;
      }
      await processJob(job);
    } catch (err) {
      console.error("[chapterWorker] top-level error:", err);
      await sleep(5000);
    }
  }
}

main().catch((err) => {
  console.error("[chapterWorker] fatal error:", err);
  process.exit(1);
});
