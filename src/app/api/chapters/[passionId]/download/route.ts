/* eslint-disable */
// app/api/chapters/[passionId]/download/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getItem } from "@/lib/dynamo";
import { s3 } from "@/lib/s3"; // your S3 client
import { GetObjectCommand } from "@aws-sdk/client-s3"; // SDK command
import { Readable } from "stream";

type Format = "pdf" | "docx" | "md" | "txt";

export async function GET(req: Request, { params }: { params: { passionId: string } }) {
  // ---- auth ----
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const email = session.user.email as string;

  // ---- locate week 01 chapter ----
  const item = await getItem(email, `CHAP#${params.passionId}#W01`);
  if (!item?.s3Key) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // ---- fetch object from S3 (SDK command directly) ----
  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET!, // ensure set in .env
      Key: item.s3Key,                // from Dynamo record
    })
  );

  const buf = await streamToBuffer(obj.Body as any);
  const md = buf.toString("utf8").trim(); // assume markdown/plain text source

  const url = new URL(req.url);
  const format = ((url.searchParams.get("format") || "pdf").toLowerCase() as Format) || "pdf";
  const filenameBase = `chapter-01-${params.passionId}`;

  try {
    if (format === "pdf") {
      const { mdToPdf } = await import("md-to-pdf");
      const pdfResult: any = await mdToPdf({ content: md });
      const pdfBuffer: Buffer = pdfResult?.pdf || pdfResult?.content;
      if (!pdfBuffer) throw new Error("PDF conversion failed");
      return new Response(pdfBuffer as any, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filenameBase}.pdf"`,
          "Cache-Control": "private, max-age=0, no-store",
        },
      });
    }

    if (format === "docx") {
      const { Document, Packer, Paragraph } = await import("docx");
      const plain = md.replace(/^\s*#+\s+/gm, "").replace(/[*_`>]/g, "");

      const doc = new Document({
        sections: [{ children: plain.split(/\n{2,}/).map((p) => new Paragraph(p)) }],
      });

      const docBuf = await Packer.toBuffer(doc);
      return new Response(docBuf as any, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${filenameBase}.docx"`,
          "Cache-Control": "private, max-age=0, no-store",
        },
      });
    }

    if (format === "md") {
      return new Response(md, {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filenameBase}.md"`,
          "Cache-Control": "private, max-age=0, no-store",
        },
      });
    }

    // default: txt
    return new Response(md, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filenameBase}.txt"`,
        "Cache-Control": "private, max-age=0, no-store",
      },
    });
  } catch (err) {
    console.error("[download] error:", err);
    return NextResponse.json({ error: "Conversion failed" }, { status: 500 });
  }
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

  // Already a Buffer/Uint8Array/String
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body, "utf8");

  return Buffer.alloc(0);
}
