/* eslint-disable */
// src/app/api/chapters/[passionId]/week/download/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getItem } from "@/lib/dynamo";
import { s3 } from "@/lib/s3";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

type Format = "pdf" | "docx" | "md" | "txt";

export async function GET(req: Request, { params }: { params: { passionId: string } }) {
  // ---- auth ----
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = session.user.email as string;

  const url = new URL(req.url);

  // ?week=01 (default 01)
  const rawWeek = url.searchParams.get("week") || "01";
  const wNum = rawWeek.replace(/^w/i, "");
  const w = String(parseInt(wNum, 10) || 1).padStart(2, "0");
  const weekNumberForName = parseInt(w, 10) || 1;

  // ?format=pdf|docx|md|txt (default pdf)
  const fmtRaw = (url.searchParams.get("format") || "pdf").toLowerCase();
  const format: Format = (["pdf", "docx", "md", "txt"].includes(fmtRaw) ? fmtRaw : "pdf") as Format;

  // optional: pass title for nicer filenames
  const title = (url.searchParams.get("title") || "").trim();

  // ---- fetch chapter text (assumes stored markdown/plain text) ----
  const item = await getItem(email, `CHAP#${params.passionId}#W${w}`);
  const s3Key = (item?.s3Key as string) || "";
  if (!s3Key) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: s3Key,
    })
  );

  const buf = await streamToBuffer(obj.Body as any);
  const md = buf.toString("utf8").trim();

  // ---- filename: chapter_1_sea_travel_via_soccer.pdf ----
  const filenameBase = buildChapterFilenameBase(weekNumberForName, title);
  const filename = `${filenameBase}.${format}`;

  try {
    if (format === "pdf") {
      // If you already have your own md->pdf builder, swap this out.
      const { mdToPdf } = await import("md-to-pdf");
      const pdfResult: any = await mdToPdf({ content: md });
      const pdfBuffer: Buffer = pdfResult?.pdf || pdfResult?.content;
      if (!pdfBuffer) throw new Error("PDF conversion failed");
      return new Response(pdfBuffer as any, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, max-age=0, no-store",
        },
      });
    }

    if (format === "docx") {
      const { Document, Packer, Paragraph } = await import("docx");

      // simple markdown strip (good enough for now)
      const plain = md
        .replace(/^\s*#+\s+/gm, "")
        .replace(/[*_`>]/g, "")
        .trim();

      const doc = new Document({
        sections: [{ children: plain.split(/\n{2,}/).map((p) => new Paragraph(p)) }],
      });

      const docBuf = await Packer.toBuffer(doc);
      return new Response(docBuf as any, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, max-age=0, no-store",
        },
      });
    }

    if (format === "md") {
      return new Response(md, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, max-age=0, no-store",
        },
      });
    }

    // txt
    return new Response(md, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    console.error("[week/download] error:", err);
    return NextResponse.json({ error: "Conversion failed" }, { status: 500 });
  }
}

function buildChapterFilenameBase(week: number, title: string) {
  // Option 3-style: chapter_1_sea_travel_via_soccer
  const safeTitle = (title || "")
    .toLowerCase()
    .replace(/[^\w]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (safeTitle) return `chapter_${week}_${safeTitle}`;
  return `chapter_${week}`;
}

/** Read an S3 Body (Buffer | Node Readable | Web ReadableStream) into Buffer */
async function streamToBuffer(body: any): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);

  // Node Readable
  if (typeof body.pipe === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of body as Readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  // Web ReadableStream
  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks.map((u) => Buffer.from(u)));
  }

  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body, "utf8");

  return Buffer.alloc(0);
}
