// middleware.ts (repo root)
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth"; // NextAuth v5 wrapper

export default auth(function middleware(req: NextRequest) {
  const res = NextResponse.next();

  // Security headers / CSP (edit as needed)
  const isDev = process.env.NODE_ENV !== "production";
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' https://api.openai.com${isDev ? " ws: http://localhost:* http://127.0.0.1:*" : ""}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "DENY");
  return res;
});


export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|healthz.txt).*)"],
};

