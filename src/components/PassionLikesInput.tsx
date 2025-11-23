// src/components/PassionLikesInput.tsx
"use client";

import * as React from "react";

const MAX_ITEMS = 20;
const MAX_LEN = 40;

export function PassionLikesInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState("");

  function addItem() {
    const text = draft.trim();
    if (!text) return;

    if (text.length > MAX_LEN) {
      setError(`Each entry can be at most ${MAX_LEN} characters.`);
      return;
    }
    if (value.length >= MAX_ITEMS) {
      setError(`You can add up to ${MAX_ITEMS} items.`);
      return;
    }

    onChange([...value, text]);
    setDraft("");
    setError("");
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            setDraft(v);
            if (v.length > MAX_LEN) {
              setError(`Each entry can be at most ${MAX_LEN} characters.`);
            } else {
              setError("");
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          className="border rounded px-2 py-1 flex-1"
          placeholder="Add an interest…"
        />
        <button type="button" onClick={addItem} className="border rounded px-3 py-1">
          Add
        </button>
      </div>

      {error ? (
        <p className="text-sm text-red-500">{error}</p>
      ) : (
        <p className="text-sm text-gray-500">
          Up to {MAX_ITEMS} items, {MAX_LEN} characters each.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {value.map((item, i) => (
            <span
            key={i}
            className="inline-flex items-center gap-1 rounded-lg bg-gray-100/90 px-3 py-1 text-sm text-gray-900"
            >
            {item}
            <button
                type="button"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                className="text-gray-500 hover:text-gray-700 focus:outline-none"
                aria-label={`Remove ${item}`}
            >
                ×
            </button>
            </span>
        ))}
      </div>

    </div>
  );
}
