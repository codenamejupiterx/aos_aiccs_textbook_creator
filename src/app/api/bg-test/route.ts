/* eslint-disable */
import { NextResponse } from "next/server";
import crypto from "crypto";
import { auth } from "@/lib/auth";
import { putItem } from "@/lib/dynamo";

export const runtime = "nodejs";

// POST /api/bg-test
export async function POST(req: Request) {
  console.log("[bg-test] enqueue start");

  // 1) Auth – same pattern as your other routes
  const session = await auth();
  const email = (session?.user as any)?.email as string | undefined;
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  // 2) Very small payload – no heavy work, no OpenAI.
  const jobId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  await putItem({
    userId: email,
    entity: `bgTestJob#${jobId}`,
    jobId,
    type: "bgTestJob",
    status: "pending",
    message: "hello from minimal bg job",
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  console.log("[bg-test] enqueued job", jobId);

  // 3) Return quickly
  return NextResponse.json(
    {
      ok: true,
      jobId,
      status: "queued",
    },
    { status: 202 } // 202 = accepted, will be processed later
  );
}
