import { useState, type FormEvent } from "react";
import { NotebookPen } from "lucide-react";

// One line, one reminder. Deliberately the least work the app asks of you: no card,
// no labels, no decisions — the receipt sorts those out later.
export default function QuickNote({ onAdd, disabled }: { onAdd: (text: string) => void; disabled?: boolean }) {
  const [text, setText] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    onAdd(value);
    setText("");
  };

  return (
    <form onSubmit={submit} className="mb-8 flex gap-2">
      <div className="relative min-w-0 flex-1">
        <NotebookPen size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          enterKeyHint="done"
          aria-label="Note a receipt to add later"
          placeholder="Note a receipt to add later, e.g. Hotel Grand 340"
          className="w-full rounded-xl border border-dashed border-slate-300 bg-white py-3 pl-9 pr-3 text-base focus:border-emerald-700 focus:outline-none disabled:opacity-50"
        />
      </div>
      <button type="submit" disabled={disabled || !text.trim()}
        className="shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium hover:border-slate-400 disabled:opacity-50">
        Note it
      </button>
    </form>
  );
}
