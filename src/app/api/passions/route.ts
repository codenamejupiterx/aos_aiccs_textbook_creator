/* eslint-disable */
// src/app/api/passions/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listPassions } from "@/lib/dynamo";

export async function GET() {
  // Get the signed-in user
  const session = await auth();
  const email = (session?.user as any)?.email || "";
  if (!email) {
    // not an error for the panel—just show empty state
    return NextResponse.json({ ok: true, passions: [] });
  }

  // Query DynamoDB: PK = email, SK begins_with("passion#")
  const items = await listPassions(email);

  // Shape rows for the panel
  const passions = (items || []).map((it: any) => ({
    id: String(it.passionId || it.id || ""),
    label: `${it.subject} — passage framed by ${it.passion}`,
    bucket: it.bucket || null,
    s3: {
      curriculumKey: it.s3CurriculumKey || null,
      chapterKey: it.s3ChapterKey || null,
      mergedKey: it.s3MergedKey || null,
    },
    status: it.status || "pending",
    createdAt: it.createdAt || null,
  }));

  return NextResponse.json({ ok: true, passions });
}
