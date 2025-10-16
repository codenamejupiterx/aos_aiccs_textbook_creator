/* eslint-disable */
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPassionById } from "@/lib/dynamo";
import { getText } from "@/lib/s3";

/** MUST match /api/generate sanitizer */
function sanitizeEmailForPath_generate(email: string) {
  // /api/generate uses exactly this: keep dots & dashes, replace everything else with underscore.
  return email.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function parseWeeks(text: string): { week: number; title: string }[] {
  // 1) whole file as JSON array
  try {
    const j = JSON.parse(text);
    if (Array.isArray(j)) {
      return j.map((w: any, i: number) => ({
        week: Number(w?.week ?? i + 1),
        title: String(w?.title ?? `Week ${w?.week ?? i + 1}`),
      }));
    }
  } catch {}
  // 2) first [...] block inside the text
  const firstOpen = text.indexOf("[");
  const lastClose = text.lastIndexOf("]");
  if (firstOpen >= 0 && lastClose > firstOpen) {
    try {
      const arr = JSON.parse(text.slice(firstOpen, lastClose + 1));
      if (Array.isArray(arr)) {
        return arr.map((w: any, i: number) => ({
          week: Number(w?.week ?? i + 1),
          title: String(w?.title ?? `Week ${w?.week ?? i + 1}`),
        }));
      }
    } catch {}
  }
  // 3) last resort: pull "title": "..."
  const titles: string[] = [];
  const re = /"title"\s*:\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) titles.push(m[1]);
  if (titles.length) return titles.map((t, i) => ({ week: i + 1, title: t }));
  return [];
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  const email = (session?.user as any)?.email as string | undefined;
  if (!email) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params; // Next 15: await params
  const item: any = await getPassionById(email, id);
  if (!item) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const bucket: string | undefined =
    item.bucket || item.s3Bucket || process.env.AWS_S3_BUCKET || process.env.BUCKET;
  if (!bucket) return NextResponse.json({ ok: true, weeks: [] });

  // Build candidate keys
  const candidates: string[] = [];
  // Prefer explicit keys from Dynamo (what /api/generate wrote)
  if (item.s3CurriculumKey) candidates.push(String(item.s3CurriculumKey));
  if (item.curriculumKey) candidates.push(String(item.curriculumKey));
  if (item.paths?.curriculumKey) candidates.push(String(item.paths.curriculumKey));

  // Fallbacks: merged/summary file that may embed the array
  if (item.s3MergedKey) candidates.push(String(item.s3MergedKey));
  if (item.summaryKey) candidates.push(String(item.summaryKey));
  if (item.paths?.summaryKey) candidates.push(String(item.paths.summaryKey));

  // Derived shapes that match /api/generate
  const safeEmail = sanitizeEmailForPath_generate(email);
  const idNoPrefix = String(id).replace(/^passion_/, "");
  candidates.push(
    `textbook/${safeEmail}/${id}/curriculum16.json`,                 // if id already starts with "passion_"
    `textbook/${safeEmail}/passion_${idNoPrefix}/curriculum16.json`  // normalize if it didn't
  );

  let txt: string | null = null;
  const tried: string[] = [];
  for (const key of candidates) {
    if (!key) continue;
    try {
      const t = await getText(bucket, key);
      tried.push(key);
      if (t) { txt = t; break; }
    } catch {
      tried.push(`${key} (miss)`);
    }
  }

  const weeksParsed = txt ? parseWeeks(txt) : [];
  const map = new Map(weeksParsed.map(w => [Number(w.week), String(w.title)]));
  const sixteen = Array.from({ length: 16 }, (_, i) => {
    const n = i + 1;
    return { week: n, title: map.get(n) || `Week ${n}` };
  });

  // Debug mode: surface what we tried so we can compare to S3
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  if (debug) {
    return NextResponse.json({
      ok: true,
      weeks: sixteen,
      debug: {
        bucket,
        itemKeys: {
          s3CurriculumKey: item.s3CurriculumKey ?? null,
          curriculumKey: item.curriculumKey ?? null,
          paths_curriculumKey: item.paths?.curriculumKey ?? null,
          s3MergedKey: item.s3MergedKey ?? null,
          summaryKey: item.summaryKey ?? null,
          paths_summaryKey: item.paths?.summaryKey ?? null,
        },
        tried,
        usedKey: tried.find(k => !k.endsWith("(miss)")) || null,
      },
    });
  }

  return NextResponse.json({ ok: true, weeks: sixteen });
}
