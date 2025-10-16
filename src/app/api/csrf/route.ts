// src/app/api/csrf/route.ts
import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

/* eslint-disable */
export const runtime = "nodejs";

export async function GET() {
  const token = randomBytes(24).toString("base64url");

  const res = NextResponse.json({ csrf: token });
  res.cookies.set({
    name: "csrf_token",
    value: token,
    httpOnly: false,     // dev: readable by JS; set true if you switch to a different token passing method
    sameSite: "lax",
    secure: false,       // true in HTTPS prod
    path: "/",
  });
  return res;
}
