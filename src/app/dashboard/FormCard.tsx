/* eslint-disable */
// app/(dashboard)/FormCard.tsx
"use client";
import { useState } from "react";

export default function GenerateFormCard({ onCreated }: { onCreated?: (id: string) => void }) {
  const [name, setName] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const [subject, setSubject] = useState("");
  const [passion, setPassion] = useState("");
  const [notes, setNotes] = useState("");
  const [loves, setLoves] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!ageRange || !subject || !passion) {
      setErrorMsg("Please fill out Age range, Subject, and Passion.");
      return;
    }

    const passionLikes = loves.split(/\n|,/).map(s => s.trim()).filter(Boolean);

    setLoading(true);
    try {
        const res = await fetch("/api/generate?debug=1", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subject, passion, ageRange, notes, passionLikes }),
        });

        if (res.status === 401) throw new Error("You must be signed in to generate a plan.");
        if (!res.ok) throw new Error(`Server error (${res.status}): ${(await res.text()).slice(0, 200)}`);

        const data = (await res.json()) as { ok: boolean; passionId?: string };
        if (!data.ok || !data.passionId) throw new Error("Unexpected response from server.");

        setSuccessMsg("Mini-chapter generated! 🎉");
        onCreated?.(data.passionId);

        setLoading(false); // optional: stop spinner before opening panel

        window.dispatchEvent(new CustomEvent("aos:refresh",     { detail: { source: "FormCard", passionId: data.passionId } }));
        window.dispatchEvent(new CustomEvent("aos:openPassions",{ detail: { source: "FormCard", passionId: data.passionId } }));
        } catch (err: unknown) {
        setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
        } finally {
        // if you moved setLoading(false) earlier, you can omit it here
        }
    }    


  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {/* Preferred name (optional) */}
      <div>
        <label className="block font-semibold text-white mb-2">Preferred name (optional)</label>
        <input
          className="w-full rounded-xl border border-white/20 bg-white text-gray-900 px-4 py-3"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g., Ms. Carter"
        />
      </div>

      {/* Age range * */}
      <div>
        <label className="block font-semibold text-white mb-2">Age range *</label>
        <select
          className="w-full rounded-xl border border-white/20 bg-white text-gray-900 px-4 py-3"
          value={ageRange}
          onChange={e => setAgeRange(e.target.value)}
          required
        >
          <option value="">Select age range</option>
          <option>Grades 3–5</option>
          <option>Grades 6–8</option>
          <option>Grades 9–12</option>
          <option>College / Adult</option>
        </select>
      </div>

      {/* Subject * */}
      <div>
        <label className="block font-semibold text-white mb-2">Subject / topic *</label>
        <input
          className="w-full rounded-xl border border-white/20 bg-white text-gray-900 px-4 py-3"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Algebra I, U.S. History, Biology…"
          required
        />
      </div>

      {/* Passion * */}
      <div>
        <label className="block font-semibold text-white mb-2">Passion *</label>
        <input
          className="w-full rounded-xl border border-white/20 bg-white text-gray-900 px-4 py-3"
          value={passion}
          onChange={e => setPassion(e.target.value)}
          placeholder="Football, anime, nails, cooking, Roblox…"
          required
        />
      </div>

      {/* Notes (optional) */}
      {/* <div>
        <label className="block font-semibold text-white mb-2">Notes (optional)</label>
        <textarea
          rows={3}
          className="w-full rounded-xl border border-white/20 bg-white text-gray-900 px-4 py-3 resize-none"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Any constraints, reading level, IEP considerations, etc."
        />
      </div>
 */}
      {/* Love list → passionLikes[] */}
      <div>
        <label className="block font-semibold text-white mb-2">List 5–10 things you love</label>
        <textarea
          rows={4}
          className="w-full rounded-xl border border-white/20 bg-white text-gray-900 px-4 py-3 resize-none"
          value={loves}
          onChange={e => setLoves(e.target.value)}
          placeholder="speed, teamwork, strategy, defense… (comma or newline)"
        />
      </div>

      {/* Submit */}
      <div className="pt-2">
        <button
          type="submit"
          disabled={loading}
          className="w-[220px] block mx-auto disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? "Generating…" : "Enter / Generate"}
        </button>
      </div>

      {errorMsg && <p className="text-red-300 text-center">{errorMsg}</p>}
      {successMsg && <p className="text-emerald-300 text-center">{successMsg}</p>}
    </form>
  );
}
