/* eslint-disable */
// app/(dashboard)/FormCard.tsx
"use client";

import { useState } from "react";
import { PassionLikesInput } from "@/components/PassionLikesInput";

const SUBJECT_MAX = 120;
const PASSION_MAX = 120;

export default function GenerateFormCard({
  onCreated,
}: {
  onCreated?: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const [subject, setSubject] = useState("");
  const [passion, setPassion] = useState("");
  const [notes, setNotes] = useState("");
  const [passionLikes, setPassionLikes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!ageRange || !subject.trim() || !passion.trim()) {
      setErrorMsg("Please fill out Age range, Subject, and Passion.");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        subject: subject.trim(),
        passion: passion.trim(),
        ageRange: ageRange.trim(),
        notes: notes.trim(),
        passionLikes, // already an array of strings
      };

      const res = await fetch("/api/generate?debug=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        throw new Error("You must be signed in to generate a plan.");
      }
      if (!res.ok) {
        throw new Error(
          `Server error (${res.status}): ${(await res.text()).slice(0, 200)}`
        );
      }

      const data = (await res.json()) as { ok: boolean; passionId?: string };
      if (!data.ok || !data.passionId) {
        throw new Error("Unexpected response from server.");
      }

      setSuccessMsg("Mini-chapter generated! 🎉");
      onCreated?.(data.passionId);

      setLoading(false); // optional: stop spinner before opening panel

      // notify other parts of the app
      window.dispatchEvent(
        new CustomEvent("aos:refresh", {
          detail: { source: "FormCard", passionId: data.passionId },
        })
      );
      window.dispatchEvent(
        new CustomEvent("aos:openPassions", {
          detail: { source: "FormCard", passionId: data.passionId },
        })
      );
    } catch (err: unknown) {
      setErrorMsg(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      // if you want the spinner to stop only after events, keep setLoading(false) here
      setLoading(false);
    }
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      {/* Preferred name (optional) */}
      <div>
        <label className="block font-semibold text-white mb-2">
          Preferred name (optional)
        </label>
        <input
          className="w-full rounded-xl border border-white/20 bg-white text-gray-900 px-4 py-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Ms. Carter"
        />
      </div>

      {/* Age range * */}
      <div>
        <label className="block font-semibold text-white mb-2">
          Age range *
        </label>
        <select
          className="w-full rounded-xl border border-white/20 bg-white text-gray-900 px-4 py-3"
          value={ageRange}
          onChange={(e) => setAgeRange(e.target.value)}
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
        <label className="block font-semibold text-white mb-2">
          Subject / topic *
        </label>
        <input
          className="w-full rounded-xl border border-white/20 bg-white text-gray-900 px-4 py-3"
          value={subject}
          maxLength={SUBJECT_MAX}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Algebra I, U.S. History, Biology…"
          required
        />
        <p className="text-xs text-gray-400 mt-1">
          {subject.length}/{SUBJECT_MAX}
        </p>
      </div>

      {/* Passion * */}
      <div>
        <label className="block font-semibold text-white mb-2">Passion *</label>
        <input
          className="w-full rounded-xl border border-white/20 bg-white text-gray-900 px-4 py-3"
          value={passion}
          maxLength={PASSION_MAX}
          onChange={(e) => setPassion(e.target.value)}
          placeholder="Football, anime, nails, cooking, Roblox…"
          required
        />
        <p className="text-xs text-gray-400 mt-1">
          {passion.length}/{PASSION_MAX}
        </p>
      </div>

      {/* Notes (optional) */}
      {/* Uncomment if you want notes back */}
      {/* <div>
        <label className="block font-semibold text-white mb-2">Notes (optional)</label>
        <textarea
          rows={3}
          className="w-full rounded-xl border border-white/20 bg-white text-gray-900 px-4 py-3 resize-none"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any constraints, reading level, IEP considerations, etc."
        />
      </div> */}

      {/* passionLikes list */}
      <div>
        <label className="block font-semibold text-white mb-2">
          List up to 20 things that you love most about the passion you listed
          above*
        </label>
        <PassionLikesInput
          value={passionLikes}
          onChange={setPassionLikes}
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

      {errorMsg && (
        <p className="text-red-300 text-center">{errorMsg}</p>
      )}
      {successMsg && (
        <p className="text-emerald-300 text-center">{successMsg}</p>
      )}
    </form>
  );
}
