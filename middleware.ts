// middleware.ts (at repo root)
export { auth as middleware } from "@/lib/auth";
// or: export { auth as middleware } from "./src/lib/auth";

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/api/user",
    "/api/generate",
    "/api/chapters/:path*",
  ],
};
