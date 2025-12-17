/* eslint-disable */
/* eslint-disable */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getItem } from "@/lib/dynamo";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ jobId: string }> } // ✅ Next 15: params is async
) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 }
    );
  }

  const email = session.user.email as string;

  // ✅ must await params in Next 15
  const { jobId } = await params;

  // ✅ bg-test jobs live under bgTestJob#<jobId>
  const item = await getItem(email, `bgTestJob#${jobId}`);
  if (!item) {
    return NextResponse.json(
      { ok: false, error: "job not found" },
      { status: 404 }
    );
  }

  const status = (item.status as string) || "pending";
  const errorMessage = (item.errorMessage as string) || null;

  // IMPORTANT: when worker finishes, it must set passionId on this row
  const passionId = (item.passionId as string) || null;

  return NextResponse.json({
    ok: true,
    status,
    passionId,
    error: status === "error" ? errorMessage : null,
    // optional debug:
    updatedAt: (item.updatedAt as string) ?? null,
  });
}
