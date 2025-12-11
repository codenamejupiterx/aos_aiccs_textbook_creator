/* eslint-disable */
//src/app/api/user/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { queryByUser } from "@/lib/dynamo";




export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const email = session.user.email as string;

    let items = [];
    try {
      items = await queryByUser(email);
    } catch (e: any) {
      console.error("queryByUser error:", e?.message || e);
      // Return an empty payload instead of crashing; UI can still load
      return NextResponse.json({ profile: {}, passions: [] }, { status: 200 });
    }

    const profile = items.find((i) => i.entity === "PROFILE") ?? {};
    const passions = items
      .filter((i) => typeof i.entity === "string" && i.entity.startsWith("PASSION#"))
      .map((p: any) => {
        const pid = (p.entity as string).split("#")[1];
        const cur = items.find((i: any) => i.entity === `CURR#${pid}`);
        return {
          _id: pid,
          name: p.name,
          subject: p.subject,
          title: `${p.subject} through the lens of ${p.name}`,
          weeks: cur?.weeks ?? [],
        };
      });

    return NextResponse.json({ profile, passions });
  } catch (e: any) {
    console.error("/api/user GET failed:", e?.message || e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // keep your existing POST (or wrap in try/catch similarly)
}


