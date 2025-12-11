/* eslint-disable */
// src/app/api/bg-test/status/[jobid]/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getItem } from "@/lib/dynamo";

export const runtime = "nodejs";

export async function GET(
  req: Request,
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

  // your jobs are stored as entity = "chapterJob#<jobId>"
  const item = await getItem(email, `chapterJob#${jobId}`);
  if (!item) {
    return NextResponse.json(
      { ok: false, error: "job not found" },
      { status: 404 }
    );
  }

  const status = (item.status as string) || "pending";
  const errorMessage = (item.errorMessage as string) || null;

  // For non-done jobs, just report status (and optional error)
  if (status !== "done") {
    return NextResponse.json({
      ok: true,
      status,
      error: status === "error" ? errorMessage : null,
    });
  }

  // When done, we expect outputBucket/outputKey/filename on the row
  const outputBucket = (item.outputBucket as string) || null;
  const outputKey = (item.outputKey as string) || null;
  const filename =
    (item.filename as string) ||
    `chapter_week${item.weekNum ?? 1}.${item.format ?? "pdf"}`;

  if (!outputBucket || !outputKey) {
    return NextResponse.json(
      {
        ok: false,
        status: "error",
        error: "job has no output location",
      },
      { status: 500 }
    );
  }

  // ✅ Same-origin route that will proxy the S3 object
  const downloadUrl = `/api/chapter-jobs/${encodeURIComponent(
    jobId
  )}/download`;

  return NextResponse.json({
    ok: true,
    status,
    downloadUrl,
    filename,
    // optional extras for debugging/inspection:
    outputBucket,
    outputKey,
  });
}
