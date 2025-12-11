/* eslint-disable */
//src/app/api/chapters/[passionId]/week/download/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getItem } from "@/lib/dynamo";
import { s3, getObjectCommand } from "@/lib/s3";
import { Readable } from "stream";

export async function GET(req: Request, { params }: { params: { passionId: string } }) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = session.user.email as string;

  // read ?week=01 (default W01)
  const url = new URL(req.url);
  const raw = url.searchParams.get("week") || "01";
  const wNum = raw.replace(/^w/i, "");
  const w = String(parseInt(wNum, 10) || 1).padStart(2, "0");

  const item = await getItem(email, `CHAP#${params.passionId}#W${w}`);
  if (!item?.s3Key) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const obj = await s3.send(getObjectCommand(item.s3Key));
  // @ts-ignore
  const webStream = Readable.toWeb(obj.Body) as ReadableStream;

  return new Response(webStream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="chapter-${w}.txt"`,
    },
  });
}
