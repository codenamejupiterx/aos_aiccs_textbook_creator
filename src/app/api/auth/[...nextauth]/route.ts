// src/app/api/auth/[...nextauth]/route.ts
export const runtime = "nodejs";
export { GET, POST } from "@/lib/auth";
// If your path alias "@" didn't resolve, use:
// export { GET, POST } from "../../../../lib/auth";
