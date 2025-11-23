/* eslint-disable */
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

  const item = await getItem(email, `chapterJob#${jobId}`);
  if (!item) {
    return NextResponse.json(
      { ok: false, error: "job not found" },
      { status: 404 }
    );
  }

  const status = (item.status as string) || "pending";

  // If not done yet, just report the status
  if (status !== "done") {
    return NextResponse.json({ ok: true, status });
  }

  // When done, we expect outputBucket/outputKey/filename on the row
  const outputBucket = (item.outputBucket as string) || null;
  const outputKey = (item.outputKey as string) || null;
  const filename =
    (item.filename as string) ||
    `chapter_week${item.weekNum ?? 1}.${item.format ?? "pdf"}`;

  if (!outputBucket || !outputKey) {
    return NextResponse.json(
      { ok: false, status: "error", error: "job has no output location" },
      { status: 500 }
    );
  }

  // IMPORTANT: give the frontend a SAME-ORIGIN URL, not raw S3
  const downloadUrl = `/api/chapter-jobs/${encodeURIComponent(
    jobId
  )}/download`;

  return NextResponse.json({
    ok: true,
    status,
    downloadUrl,
    filename,
  });
}
