// src/worker/bgTestWorker.ts
/* eslint-disable */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" }); // load .env.local for the worker

import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
  GetItemCommand,
} from "@aws-sdk/client-dynamodb";
import { putText } from "../lib/s3";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DDB_TABLE; // same table you use in putItem()

import { z } from "zod";
import OpenAI from "openai";

/* ----------------------------- ZOD VALIDATION ----------------------------- */
const MAX_ITEMS = 20;
const MAX_LEN = 40;

const BodySchema = z.object({
  email: z.string().email().optional(),
  subject: z.string().min(1).max(120),
  passion: z.string().min(1).max(120),
  ageRange: z.enum(["Grades 3–5", "Grades 6–8", "Grades 9–12", "College / Adult"]),
  notes: z.string().max(2000).optional().default(""),
  passionLikes: z
    .array(z.string().min(1).max(MAX_LEN))
    .max(MAX_ITEMS)
    .optional()
    .default([]),
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

/* ----------------------------- OpenAI client ------------------------------ */
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});


if (!TABLE) {
  throw new Error("DDB_TABLE env var is required for bgTestWorker");
}

const ddb = new DynamoDBClient({ region: REGION });

type BgTestJob = {
  userId: string;
  entity: string; // "bgTestJob#<jobId>"
  jobId: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find ONE pending bgTestJob and atomically mark it as "running".
 */
async function claimNextPendingBgTestJob(): Promise<BgTestJob | null> {
  console.log("[bgTestWorker] scanning for pending jobs...");

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
        ":prefix": { S: "bgTestJob#" },
        ":pending": { S: "pending" },
      },
    })
  );

  const item = (scan.Items ?? [])[0];
  if (!item) {
    console.log("[bgTestWorker] no pending job found");
    return null;
  }

  const userId = item.userId?.S;
  const entity = item.entity?.S;
  const status = item.status?.S;
  const jobId = item.jobId?.S;

  if (!userId || !entity || !jobId || status !== "pending") {
    console.warn("[bgTestWorker] item missing fields or not pending:", item);
    return null;
  }

  // Try to flip pending → running atomically
  try {
    await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: {
          userId: { S: userId },
          entity: { S: entity },
        },
        UpdateExpression:
          "SET #status = :running, #updatedAt = :now",
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
      "[bgTestWorker] failed to claim job (race or already claimed):",
      jobId,
      err?.name
    );
    return null;
  }

  console.log("[bgTestWorker] claimed job:", { jobId, userId });
  return { userId, entity, jobId };
}

async function processJob(job: BgTestJob) {
  console.log("[bgTestWorker] processing job:", job.jobId);

  // 1) Load full record so we can see inputText
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
  const inputText = item.inputText?.S || "";

  if (!inputText) {
    console.error("[bgTestWorker] no inputText on job item");
    await markFailed(job, "Missing inputText on job record");
    return;
  }

  // 2) Parse JSON -> Body using the same schema as /api/generate
  let body: Body;
  try {
    body = BodySchema.parse(JSON.parse(inputText));
  } catch (err: any) {
    console.error("[bgTestWorker] invalid inputText JSON:", err);
    await markFailed(job, "Invalid input JSON for BodySchema");
    return;
  }

  const email = (body.email || job.userId).trim();
  const subject = body.subject.trim();
  const passion = body.passion.trim();
  const ageRange = body.ageRange;
  const notes = body.notes?.trim() ?? "";
  const passionLikes = (body.passionLikes ?? []).slice(0, 10);

  const bucket = process.env.BUCKET || process.env.AWS_S3_BUCKET;
  if (!bucket) {
    console.error("[bgTestWorker] BUCKET / AWS_S3_BUCKET env missing");
    await markFailed(job, "Missing BUCKET / AWS_S3_BUCKET env var");
    return;
  }

  const emailSafe = email.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const prefix = `textbook/${emailSafe}/${job.jobId}/`;
  const keys = {
    curriculum: `${prefix}curriculum16.json`,
    chapter: `${prefix}week1_chapter.md`,
    merged: `${prefix}summary.txt`,
  };

  // 3) Call OpenAI (or fallback) to build curriculum + chapter
  let curriculum16: any[] | null = null;
  let week1Chapter: { title: string; body: string } | null = null;
  let openaiError: string | null = null;

  try {
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
    // ... weeks 2-16, same shape
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

### VALIDATION
- Return ONLY compact JSON (no comments/newlines beyond JSON, no trailing commas).
- Ensure curriculum16 has exactly 16 objects with week=1..16 and unique titles.
`.trim();

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-5",
      response_format: { type: "json_object" },
      //temperature: 0.4,
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
    openaiError = e?.message || String(e);
    console.error("[bgTestWorker] OpenAI error, using fallback:", openaiError);
    curriculum16 = buildLocalCurriculum(subject, passion, passionLikes);
    week1Chapter = buildLocalWeek1(subject, passion, ageRange, passionLikes, notes);
  }

  if (!curriculum16 || !week1Chapter) {
    await markFailed(job, "Generation failed (OpenAI+fallback both empty)");
    return;
  }

  // 4) Write outputs to S3 and mark job done
  try {
    const curriculumText = JSON.stringify(curriculum16, null, 2);
    const chapterText = `# ${week1Chapter.title || "Week 1"}\n\n${
      (week1Chapter as any).body || week1Chapter.body || ""
    }`;

    await putText(bucket, keys.curriculum, curriculumText, "application/json");
    await putText(bucket, keys.chapter, chapterText, "text/markdown; charset=utf-8");
    await putText(
      bucket,
      keys.merged,
      `Curriculum:\n${curriculumText}\n\n---\n\nChapter:\n${chapterText}`,
      "text/plain; charset=utf-8"
    );

    await ddb.send(
      new UpdateItemCommand({
        TableName: TABLE,
        Key: {
          userId: { S: job.userId },
          entity: { S: job.entity },
        },
        UpdateExpression:
          "SET #status = :done, #outputBucket = :bucket, #curriculumKey = :cKey, #chapterKey = :chKey, #mergedKey = :mKey, updatedAt = :now",
        ExpressionAttributeNames: {
          "#status": "status",
          "#outputBucket": "outputBucket",
          "#curriculumKey": "curriculumKey",
          "#chapterKey": "chapterKey",
          "#mergedKey": "mergedKey",
        },
        ExpressionAttributeValues: {
          ":done": { S: "done" },
          ":bucket": { S: bucket },
          ":cKey": { S: keys.curriculum },
          ":chKey": { S: keys.chapter },
          ":mKey": { S: keys.merged },
          ":now": { S: new Date().toISOString() },
        },
      })
    );

    console.log(
      "[bgTestWorker] job DONE:",
      job.jobId,
      "->",
      `${bucket}/${keys.curriculum} & ${keys.chapter}`
    );
  } catch (err: any) {
    console.error("[bgTestWorker] job FAILED during S3 write:", job.jobId, err);
    await markFailed(job, (err?.message ?? String(err)).slice(0, 500));
  }
}


async function markFailed(job: BgTestJob, msg: string) {
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

/**
 * Main polling loop.
 */
async function main() {
  console.log("[bgTestWorker] starting background worker loop...");

  while (true) {
    try {
      const job = await claimNextPendingBgTestJob();
      if (!job) {
        // nothing to do → rest a bit
        await sleep(5000);
        continue;
      }

      await processJob(job);
    } catch (err) {
      console.error("[bgTestWorker] top-level error:", err);
      await sleep(5000);
    }
  }
}

main().catch((err) => {
  console.error("[bgTestWorker] fatal error:", err);
  process.exit(1);
});
