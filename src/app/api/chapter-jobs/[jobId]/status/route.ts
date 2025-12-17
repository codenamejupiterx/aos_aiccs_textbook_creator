/* eslint-disable */
// src/app/api/chapter-jobs/[jobId]/status/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getItem } from "@/lib/dynamo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ jobId: string }> } // ✅ Next 15
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const { jobId } = await ctx.params; // ✅ REQUIRED in Next 15
  const email = String(session.user.email).toLowerCase();

  // ✅ direct PK lookup
  const item: any = await getItem(email, `chapterJob#${jobId}`);

  if (!item) {
    // keep your “missing is ok:true” behavior from the second snippet
    return NextResponse.json({ ok: true, status: "missing" }, { status: 200 });
  }

  const status = (item.status as string) || "pending";

  // ==========================================================
  // NOT DONE path:
  //   1) failed -> error (stop polling)
  //   2) fallback: if CHAP output exists, treat as done
  //   3) otherwise return pending/running/etc + useful fields
  // ==========================================================
  if (status !== "done") {
    if (status === "failed") {
      return NextResponse.json(
        {
          ok: true,
          status: "error",
          error:
            (item.errorMessage as string) ||
            (item.error as string) ||
            "Chapter generation failed. Please try again.",
        },
        { status: 200 }
      );
    }

    // 2) fallback: if final chapter record exists, treat as done
    try {
      const weekNum = Number(item.weekNum ?? item.week ?? 1);
      const w = String(weekNum).padStart(2, "0");

      const passionId = String(item.passionId || item.passionID || "");
      if (passionId) {
        const ownerEmail = String(item.ownerEmail ?? email).toLowerCase();
        const chap: any = await getItem(ownerEmail, `CHAP#${passionId}#W${w}`);

        const hasOutput =
          !!chap?.s3Key || !!chap?.s3?.chapterKey || !!chap?.s3?.mergedKey;

        if (hasOutput) {
          const downloadUrl = `/api/chapter-jobs/${encodeURIComponent(
            jobId
          )}/download`;

          return NextResponse.json(
            {
              ok: true,
              status: "done",
              downloadUrl,
              filename: null, // you can override filename in download route
            },
            { status: 200 }
          );
        }
      }
    } catch (e) {
      console.error("[status fallback] check CHAP failed:", e);
    }

    // 3) normal “still working” response (keep it informative)
    return NextResponse.json(
      {
        ok: true,
        status,
        jobId: item.jobId ?? jobId,
        passionId: item.passionId ?? null,
        week: item.weekNum ?? item.week ?? null,
        s3Key: item.s3Key ?? null,
        error: item.error ?? null,
        updatedAt: item.updatedAt ?? null,
      },
      { status: 200 }
    );
  }

  // ==========================================================
  // DONE path
  // ==========================================================
  const outputBucket = (item.outputBucket as string) || null;
  const outputKey = (item.outputKey as string) || null;

  const filename =
    (item.filename as string) ||
    `chapter_week${item.weekNum ?? 1}.${item.format ?? "pdf"}`;

  if (!outputBucket || !outputKey) {
    return NextResponse.json(
      { ok: true, status: "error", error: "job has no output location" },
      { status: 200 }
    );
  }

  const downloadUrl = `/api/chapter-jobs/${encodeURIComponent(
    jobId
  )}/download`;

  return NextResponse.json(
    {
      ok: true,
      status: "done",
      downloadUrl,
      filename,
    },
    { status: 200 }
  );
}
