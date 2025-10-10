// src/app/api/passions/[id]/weeks/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPassionById } from "@/lib/dynamo";
import { getText } from "@/lib/s3";

/** turn "benjaforge@gmail.com" -> "benjaforge_gmail_com" */
function sanitizeEmailForPath(email: string) {
  return email.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

/** Try to parse an array of {week,title,...} from a text blob. */
function parseWeeks(text: string): { week: number; title: string }[] {
  // 1) try whole file as JSON
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) {
      return j.map((w: any, i: number) => ({
        week: Number(w?.week ?? i + 1),
        title: String(w?.title ?? `Week ${w?.week ?? i + 1}`),
      }));
    }
  } catch {}

  // 2) try first [...] block in the file (summary.txt often has prose + JSON)
  const firstOpen = text.indexOf("[");
  const lastClose = text.lastIndexOf("]");
  if (firstOpen >= 0 && lastClose > firstOpen) {
    const block = text.slice(firstOpen, lastClose + 1);
    try {
      const arr = JSON.parse(block);
      if (Array.isArray(arr)) {
        return arr.map((w: any, i: number) => ({
          week: Number(w?.week ?? i + 1),
          title: String(w?.title ?? `Week ${w?.week ?? i + 1}`),
        }));
      }
    } catch {}
  }

  // 3) final fallback: pull "title": "..." pairs via regex
  const titles: string[] = [];
  const re = /"title"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) titles.push(m[1]);
  if (titles.length) {
    return titles.map((t, i) => ({ week: i + 1, title: t }));
  }

  return [];
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  // Require login
  const session = await auth();
  const email = (session?.user as any)?.email as string | undefined;
  if (!email) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // Get passion record (so we can read bucket/keys if present)
  const item: any = await getPassionById(email, params.id);
  if (!item) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  // Bucket
  const bucket: string | undefined =
  item.bucket || item.s3Bucket || process.env.AWS_S3_BUCKET || process.env.BUCKET;

  if (!bucket) return NextResponse.json({ ok: true, weeks: [] });

  // Preferred key (if you ever save a clean JSON file)
  const curriculumKey: string | undefined =
    item.s3CurriculumKey || item.curriculumKey || item.paths?.curriculumKey;

  // Summary key from item, if present
  let summaryKey: string | undefined =
    item.s3MergedKey || item.summaryKey || item.paths?.summaryKey;

  // If summaryKey missing, derive it from the known pattern:
  // textbook/<sanitized-email>/passion_<id>/summary.txt
  if (!curriculumKey && !summaryKey) {
    const safeEmail = sanitizeEmailForPath(email);
    summaryKey = `textbook/${safeEmail}/passion_${params.id}/curriculum16.json`;
  }

  let weeks: { week: number; title: string }[] = [];

  try {
    if (curriculumKey) {
      const txt = await getText(bucket, curriculumKey);
      weeks = parseWeeks(txt);
    } else if (summaryKey) {
      const txt = await getText(bucket, summaryKey);
      weeks = parseWeeks(txt);
    }
  } catch (e) {
    console.error("[/api/passions/:id/weeks] read/parse error:", e);
  }

  // Normalize to exactly 16 rows (autofill gaps)
  const map = new Map(weeks.map(w => [Number(w.week), String(w.title)]));
  const sixteen = Array.from({ length: 16 }, (_, i) => {
    const n = i + 1;
    return { week: n, title: map.get(n) || `Week ${n}` };
  });

  return NextResponse.json({ ok: true, weeks: sixteen });
}
