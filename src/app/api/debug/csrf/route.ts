/* eslint-disable */
// src/app/api/debug/csrf/route.ts
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const origin  = req.headers.get("origin")  ?? null;
    const referer = req.headers.get("referer") ?? null;
    const header  = req.headers.get("x-csrf-token") ?? null;

    // ✅ Use the request's cookie jar (no TS error)
    const cookie  = req.cookies.get("csrf_token")?.value ?? null;

    const ok = !!header && header === cookie;
    return NextResponse.json({ ok, origin, referer, header, cookie });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message || err) }, { status: 500 });
  }
}
