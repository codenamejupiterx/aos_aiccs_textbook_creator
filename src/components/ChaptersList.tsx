"use client";

type Week = { week: number; title: string };

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function onClickMiniChapter(passionId: string, week: number, title: string) {
  try {
    const res = await fetch(`/api/chapters/${encodeURIComponent(passionId)}/weeks/${week}/chapter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({} as any));
      throw new Error(err?.error || `HTTP ${res.status}`);
    }

    const blob = await res.blob();
    const disp = res.headers.get("Content-Disposition") || "";
    const m = disp.match(/filename="([^"]+)"/);
    const filename = m?.[1] || `chapter_week${week}.md`;

    downloadBlob(blob, filename);
  } catch (e: any) {
    alert(`Failed to generate chapter: ${e?.message || e}`);
  }
}

export default function ChaptersList({
  passionId,
  weeks,
}: {
  passionId: string;
  weeks: Week[];
}) {
  return (
    <ul className="divide-y">
      {weeks.map((w) => (
        <li key={w.week} className="py-2 flex items-center justify-between">
          <span>{w.title}</span>
          <button
            onClick={() => onClickMiniChapter(passionId, w.week, w.title)}
            className="rounded-md px-3 py-1.5 text-sm border hover:bg-gray-50"
          >
            Generate & Download
          </button>
        </li>
      ))}
    </ul>
  );
}
