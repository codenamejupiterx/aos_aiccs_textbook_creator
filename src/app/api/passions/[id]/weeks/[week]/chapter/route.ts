/* eslint-disable */
// src/app/api/passions/[id]/weeks/[week]/chapter/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // optional


import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import crypto from "crypto";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.DDB_TABLE;
const ddb = new DynamoDBClient({ region: REGION });




// IMPORTANT: must match what your worker queries for
const JOB_PENDING_PK = "JOB#PENDING";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; week: string }> }
) {
  if (!TABLE) {
    return NextResponse.json(
      { ok: false, error: "DDB_TABLE not configured" },
      { status: 500 }
    );
  }

  // ---------- auth ----------
  const session = await auth();
  const emailRaw = (session?.user as any)?.email?.trim?.() || "";
  const email = String(emailRaw).toLowerCase();
  if (!email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // ---------- params ----------
  const { id, week } = await ctx.params;
  const passionId = decodeURIComponent(id || "");
  const weekNum = Number(week || "1");

  if (!passionId || !Number.isFinite(weekNum) || weekNum <= 0) {
    return NextResponse.json({ ok: false, error: "bad_params" }, { status: 400 });
  }

  // ---------- query flags ----------
  const url = new URL(req.url);

  const debugMode = ["1", "true", "yes", "debug"].includes(
    (url.searchParams.get("debug") || "").toLowerCase()
  );
  const spacious = ["1", "true", "yes", "spacious", "wide", "roomy"].includes(
    (url.searchParams.get("layout") || "").toLowerCase()
  );
  const docxRawFlag = url.searchParams.get("docxRaw") === "1";
  const rawPdfFlag = url.searchParams.get("raw") === "1";

  const fmtRaw = (url.searchParams.get("format") || "pdf").toLowerCase();
  const format =
    fmtRaw === "docx" || fmtRaw === "md" || fmtRaw === "html" ? fmtRaw : "pdf";

  // ---------- body (chapter title) ----------
  let title = "";
  try {
    const body = (await req.json()) as { title?: string };
    title = (body?.title || "").trim();
  } catch {
    // empty body allowed
  }
  if (!title) title = `Week ${weekNum} Chapter`;

  // ---------- enqueue job ----------
   // ---------- enqueue job in DynamoDB ----------
  const jobId = crypto.randomUUID();
  const entity = `chapterJob#${jobId}`;
  const nowIso = new Date().toISOString();

  const ownerEmail = String(email).toLowerCase();

  const inputObj = {
    passionId,
    weekNum,
    format,
    chapterTitle: title,
    debugMode,
    spacious,
    docxRawFlag,
    rawPdfFlag,
  };

  const item = {
    userId: { S: ownerEmail },
    entity: { S: entity },
    jobId: { S: jobId },

    ownerEmail: { S: ownerEmail },
    passionId: { S: passionId },
    weekNum: { N: String(weekNum) },
    format: { S: format },
    chapterTitle: { S: title },

    spacious: { BOOL: spacious },
    debugMode: { BOOL: debugMode },
    docxRawFlag: { BOOL: docxRawFlag },
    rawPdfFlag: { BOOL: rawPdfFlag },

    // ✅ worker visibility + debugging
    input: { S: JSON.stringify(inputObj) },

    // ✅ this is what your worker’s GSI “pending jobs” query should match
    gsi1pk: { S: JOB_PENDING_PK },
    gsi1sk: { S: `chapterJob#${nowIso}#${jobId}` },

    status: { S: "pending" },
    type: { S: "chapterJob" },
    createdAt: { S: nowIso },
    updatedAt: { S: nowIso },
  };


  await ddb.send(
    new PutItemCommand({
      TableName: TABLE,
      Item: item,
    })
  );

  return NextResponse.json({ ok: true, jobId, status: "queued" }, { status: 202 });
}
