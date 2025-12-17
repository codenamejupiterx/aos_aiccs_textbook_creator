/* eslint-disable */
// src/app/api/chapter-jobs/[jobId]/download/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getItem } from "@/lib/dynamo";
import { s3 } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

export const runtime = "nodejs";

type Format = "pdf" | "docx" | "md" | "txt";

function safeSlug(input: string) {
  return (input || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")          // spaces -> _
    .replace(/[^\w]+/g, "_")       // drop weird chars
    .replace(/_+/g, "_")           // collapse ___
    .replace(/^_+|_+$/g, "");      // trim edges
}

function stripWeekPrefix(t: string) {
  return (t || "").replace(/^week\s*\d+\s*[:\-–—]?\s*/i, "").trim();
}

function buildChapterFilename(weekNum: number, title: string, format: Format) {
  const wk = Number.isFinite(weekNum) && weekNum > 0 ? weekNum : 1;

  const cleanedTitle = stripWeekPrefix(title);   // ✅ remove “Week 1 ”
  const slug = safeSlug(cleanedTitle);

  return slug ? `chapter_${wk}_${slug}.${format}` : `chapter_${wk}.${format}`;
}


export async function GET(_req: Request, { params }: { params: { jobId: string } }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const email = session.user.email as string;
  const jobId = params.jobId;

  const item = await getItem(email, `chapterJob#${jobId}`);
  if (!item) {
    return NextResponse.json({ ok: false, error: "job not found" }, { status: 404 });
  }

  const bucket =
    (item.outputBucket as string) ||
    process.env.BUCKET ||
    process.env.AWS_S3_BUCKET ||
    process.env.S3_BUCKET!;

  const key = item.outputKey as string | undefined;
  if (!key) {
    return NextResponse.json({ ok: false, error: "no output key on job" }, { status: 500 });
  }

  // Format
  const rawFmt = String(item.format ?? "pdf").toLowerCase();
  const format = (["pdf", "docx", "md", "txt"].includes(rawFmt) ? rawFmt : "pdf") as Format;

  // Week number (job may store weekNum or week)
  const weekNum = Number(item.weekNum ?? item.week ?? 1) || 1;

  // Title (try a few possible fields)
  const title =
    String(item.chapterTitle ?? item.title ?? item.weekTitle ?? "").trim();

  // ✅ OVERRIDE filename here (instead of item.filename)
  const filename = buildChapterFilename(weekNum, title, format);

  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  // convert Node stream to Web stream
  // @ts-ignore
  const webStream: ReadableStream = Readable.toWeb(obj.Body as any) as ReadableStream;

  const mime =
    format === "pdf"
      ? "application/pdf"
      : format === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : format === "md"
      ? "text/markdown; charset=utf-8"
      : "text/plain; charset=utf-8";

  return new Response(webStream, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
