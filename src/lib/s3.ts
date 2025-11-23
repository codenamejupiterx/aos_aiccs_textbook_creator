/* eslint-disable */
// src/lib/s3.ts
//import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

/** Single client (don’t recreate per call) */
const REGION = process.env.AWS_REGION || "us-east-1";
export const s3 = new S3Client({ region: REGION }); // <-- export this

/** Optional helper so callers don’t repeat Bucket every time */
export const getObjectCommand = (Key: string) =>
  new GetObjectCommand({ Bucket: process.env.S3_BUCKET!, Key });

/** Upload plain text (or JSON/markdown via contentType) */
export async function putText(
  bucket: string,
  key: string,
  body: string | Uint8Array,   // ⬅️ allow both text *and* binary
  contentType: string
) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,               // Uint8Array is valid for S3 Body
      ContentType: contentType,
    })
  );
}

/** Convert SDK Body → string (handles Node Readable or Web ReadableStream) */
async function bodyToString(body: any): Promise<string> {
  if (body && typeof body.on === "function") {
    const chunks: Buffer[] = [];
    for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks).toString("utf-8");
  }
  if (body?.getReader) {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.byteLength;
    }
    return new TextDecoder("utf-8").decode(merged);
  }
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return new TextDecoder("utf-8").decode(body);
  return "";
}

/** Download an object as UTF-8 text */
export async function getText(bucket: string, key: string): Promise<string> {
  if (!bucket) throw new Error("getText: missing bucket");
  if (!key) throw new Error("getText: missing key");

  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return bodyToString(res.Body as any);
}

/** Handy helper if you often store JSON */
export async function getJSON<T = unknown>(bucket: string, key: string): Promise<T> {
  const txt = await getText(bucket, key);
  return JSON.parse(txt) as T;
}
