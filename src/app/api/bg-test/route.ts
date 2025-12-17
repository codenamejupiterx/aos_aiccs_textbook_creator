/* eslint-disable */
// src/app/api/bg-test/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { putItem } from "@/lib/dynamo"; // <-- if yours is named differently, change this import

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function newId(prefix: string) {
  // good enough for ids; you can use crypto.randomUUID() directly too
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const email = String(session.user.email).toLowerCase();

  const body = await req.json().catch(() => null);
  const subject = String(body?.subject ?? "").trim();
  const passion = String(body?.passion ?? "").trim();
  const ageRange = String(body?.ageRange ?? "").trim();
  const notes = String(body?.notes ?? "").trim();
  const passionLikes = Array.isArray(body?.passionLikes) ? body.passionLikes : [];

  if (!subject || !passion || !ageRange) {
    return NextResponse.json(
      { ok: false, error: "Missing required fields: subject, passion, ageRange" },
      { status: 400 }
    );
  }

  // ✅ Create the Passion row immediately (fast path)
  const passionId = newId("passion");
  const now = new Date().toISOString();

  // This is the “label” that shows in your slideout list
  const label = subject; // or `${subject} (${passion})` if you prefer

  // IMPORTANT:
  // Use the SAME PK/SK shape your /api/passions list expects.
  // From your job row example, your table uses:
  //   PK: userId
  //   SK: entity
  //
  // This stores a Passion row at:
  //   userId = email
  //   entity = `passion#${passionId}`
  //
  // If your existing passions use `passion_${uuid}` directly in entity, change entity below accordingly.
  const item = {
    userId: email,
    entity: `passion#${passionId}`,
    type: "passion",
    id: passionId,          // handy if your UI reads item.id
    passionId,              // handy if your UI reads item.passionId
    label,
    subject,
    passion,
    ageRange,
    notes,
    passionLikes,
    status: "ready",        // key: makes it appear immediately
    createdAt: now,
    updatedAt: now,

    // optional “stubs” so weeks list renders instantly (if you use it)
    // If your /api/passions/[id]/weeks builds weeks dynamically, you can remove this.
    weeksCount: 16,
  };

  await putItem(item);

  // ✅ Return immediately (no polling needed)
  // UI can call loadPassions(), open slideout, and highlight passionId right away.
  return NextResponse.json(
    { ok: true, status: "ready", passionId, updatedAt: now },
    { status: 200 }
  );
}
