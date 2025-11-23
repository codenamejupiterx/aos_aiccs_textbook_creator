/* eslint-disable */
// src/app/api/chapter-jobs/run-one/route.ts

import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Temporary stub while we rebuild chapter generation.
 * This prevents Next.js from failing the production build.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "chapter generation is temporarily disabled while we refactor.",
    },
    { status: 503 }
  );
}
