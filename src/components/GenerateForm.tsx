/* eslint-disable */
"use client";
import { useState } from "react";
import { useSession, signOut } from "next-auth/react";


type Props = { onDone?: () => void };

const AGE_CHOICES = ["5–8","9–12","13–15","16–18","19–24","25–34","35–49","50–64","65+"];

export default function GenerateForm({ onDone }: Props) {
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", ageRange: "", subject: "", passion: "",
    notes: "", likes: ""
  });

  async function submit() {
    setMsg(null);
    if (!form.name || !form.ageRange || !form.subject || !form.passion) {
      setMsg("Please fill all required fields."); return;
    }
    setLoading(true);
    try {
      await fetch("/api/user", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: form.name, ageRange: form.ageRange }),
      });

      const passionLikes = form.likes.split(/\n|,/).map(s => s.trim()).filter(Boolean);

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: form.subject,
          passion: form.passion,
          ageRange: form.ageRange,
          notes: form.notes,
          passionLikes,
        }),
      });

      if (!res.ok) throw new Error("Generation failed");

      setMsg("Created 16-week plan + Week 1 chapter!");
      setForm({ name: form.name, ageRange: form.ageRange, subject: "", passion: "", notes: "", likes: "" });

      // notify any listeners (e.g., the dashboard page on the right) to refresh
      window.dispatchEvent(new CustomEvent("aos:refresh"));
      onDone?.();
    } catch (e: any) {
      setMsg(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-4 bg-white border rounded-2xl space-y-3">
      <h2 className="text-lg font-semibold">Create new plan</h2>

      <div className="grid md:grid-cols-2 gap-2">
        <input className="border rounded-lg p-2" placeholder="Preferred name *"
               value={form.name} onChange={e=>setForm({...form, name:e.target.value})}/>
        <select className="border rounded-lg p-2" value={form.ageRange}
                onChange={e=>setForm({...form, ageRange:e.target.value})}>
          <option value="">Age range *</option>
          {AGE_CHOICES.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input className="border rounded-lg p-2" placeholder="Subject / topic *"
               value={form.subject} onChange={e=>setForm({...form, subject:e.target.value})}/>
        <input className="border rounded-lg p-2" placeholder="Passion *"
               value={form.passion} onChange={e=>setForm({...form, passion:e.target.value})}/>
      </div>

      <textarea className="border rounded-lg p-2 w-full" rows={3}
        placeholder="Notes (optional)" value={form.notes}
        onChange={e=>setForm({...form, notes:e.target.value})}/>

      <textarea className="border rounded-lg p-2 w-full" rows={4}
        placeholder="List 5–10 things you love about your passion (comma or new line)"
        value={form.likes} onChange={e=>setForm({...form, likes:e.target.value})}/>

      <button onClick={submit} disabled={loading}
              className="px-4 py-2 rounded-lg bg-black text-white disabled:opacity-50">
        {loading ? "Working…" : "Enter / Generate"}
      </button>
      {msg && <p className="text-sm text-gray-700">{msg}</p>}
    </div>
  );
}
