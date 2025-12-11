/* eslint-disable */
// src/app/api/chapter-jobs/[jobId]/download/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getItem } from "@/lib/dynamo";
import { s3 } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { jobId: string } }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const email = session.user.email as string;
  const jobId = params.jobId;

  const item = await getItem(email, `chapterJob#${jobId}`);
  if (!item) {
    return NextResponse.json(
      { ok: false, error: "job not found" },
      { status: 404 }
    );
  }

  const bucket =
    (item.outputBucket as string) ||
    process.env.BUCKET ||
    process.env.AWS_S3_BUCKET ||
    process.env.S3_BUCKET!;

  const key = item.outputKey as string | undefined;
  const filename =
    (item.filename as string) ||
    `chapter_week${item.weekNum ?? 1}.${item.format ?? "pdf"}`;
  const format = (item.format as string) || "pdf";

  if (!key) {
    return NextResponse.json(
      { ok: false, error: "no output key on job" },
      { status: 500 }
    );
  }

  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  // convert Node stream to Web stream
  // @ts-ignore
  const webStream: ReadableStream = Readable.toWeb(
    obj.Body as any
  ) as ReadableStream;

  const mime =
    format === "pdf"
      ? "application/pdf"
      : format === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/octet-stream";

  return new Response(webStream, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
