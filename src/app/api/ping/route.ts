/* eslint-disable */
// src/app/api/ping/route.ts
export const runtime = "edge"; // optional; fine on node too

export async function GET(req: Request) {
  const hasCsrf = /(?:^|;\s*)csrf_token=/.test(req.headers.get("cookie") ?? "");
  return new Response(hasCsrf ? "ok:csrf" : "ok:no-csrf", {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
