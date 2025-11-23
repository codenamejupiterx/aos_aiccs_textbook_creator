// src/app/api/image-jobs/[id]/run/route.ts
/* eslint-disable */
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  getItemByUserEntity,
  updatePassion, // we'll reuse this to update the job item
} from "@/lib/dynamo";
import { generateDiagramImage } from "@/lib/imageGen";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const jobId = params.id;
  if (!jobId) {
    return NextResponse.json(
      { ok: false, error: "missing_job_id" },
      { status: 400 }
    );
  }

  // 1) same auth style as your other routes
  const session = await auth();
  const email = (session?.user as any)?.email as string | undefined;
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  // 2) load the job from Dynamo
  const entity = `imagejob#${jobId}`;
  const job = await getItemByUserEntity(email, entity);
  if (!job) {
    return NextResponse.json(
      { ok: false, error: "job_not_found", detail: { userId: email, entity } },
      { status: 404 }
    );
  }

  const prompts: string[] = Array.isArray(job.prompts) ? job.prompts : [];
  if (!prompts.length) {
    return NextResponse.json(
      { ok: false, error: "job_has_no_prompts" },
      { status: 400 }
    );
  }

  // 3) mark as running
  await updatePassion(email, entity, {
    status: "running",
    updatedAt: new Date().toISOString(),
  });

  const results: Record<string, string> = {};
  const errors: Record<string, string> = {};

  // 4) actually generate — sequential to be gentle
  for (const prompt of prompts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const url = await generateDiagramImage(prompt);
      if (url) {
        results[prompt] = url;
      } else {
        errors[prompt] = "no_url_returned";
      }
    } catch (err: any) {
      console.error("[image-job] generate failed:", prompt, err);
      errors[prompt] = err?.message || "unknown_error";
    }
  }

  const done = Object.keys(errors).length === 0;

  // 5) write results back to the SAME item
  await updatePassion(email, entity, {
    status: done ? "done" : "error",
    results,
    errors,
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json(
    {
      ok: true,
      status: done ? "done" : "error",
      results,
      errors,
    },
    { status: 200 }
  );
}
