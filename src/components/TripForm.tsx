import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { Trip } from "../lib/types";

const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-emerald-700 focus:outline-none";

type Props = {
  initial: Trip;
  isNew: boolean;
  onSave: (trip: Trip) => void;
  onCancel: () => void;
};

function validateTrip(t: Trip) {
  const e: Partial<Record<keyof Trip, string>> = {};
  if (!t.label.trim()) e.label = "Give the trip a name.";
  if (!t.destination.trim()) e.destination = "Where was it?";
  if (!t.workStart) e.workStart = "Enter the first day.";
  if (!t.workEnd) e.workEnd = "Enter the last day.";
  else if (t.workStart && t.workEnd < t.workStart) e.workEnd = "Ends before it starts.";
  if (!t.travelStart) e.travelStart = "Enter the day you left.";
  else if (t.workStart && t.travelStart > t.workStart) e.travelStart = "You left home after the event started.";
  if (!t.travelEnd) e.travelEnd = "Enter the day you got back.";
  else if (t.workEnd && t.travelEnd < t.workEnd) e.travelEnd = "You got home before the event ended.";
  return e;
}

// Shown over whatever screen opened it, including the review card, so a trip can be
// added at the moment a receipt needs one (§5).
export default function TripForm({ initial, isNew, onSave, onCancel }: Props) {
  const [t, setT] = useState(initial);
  const [showErrors, setShowErrors] = useState(false);
  const errors = showErrors ? validateTrip(t) : {};
  const set = (patch: Partial<Trip>) => setT({ ...t, ...patch });

  const save = () => {
    if (Object.keys(validateTrip(t)).length) return setShowErrors(true);
    onSave({ ...t, label: t.label.trim(), destination: t.destination.trim(), notes: t.notes.trim() });
  };

  const input = (key: keyof Trip) => `${field} ${errors[key] ? "border-red-500" : ""}`;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-black/40 px-4 py-6" role="dialog" aria-modal="true" aria-label="Trip details">
      <div className="mx-auto max-w-lg rounded-2xl bg-white p-5 shadow-lg">
        <div className="mb-1 flex items-start justify-between gap-3">
          <h2 className="font-semibold">{isNew ? "New trip" : "Edit trip"}</h2>
          <button type="button" onClick={onCancel} aria-label="Close" className="rounded p-1 text-slate-500 hover:text-slate-900">
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-sm text-slate-600">
          The event dates decide which days are claimable. The travel dates decide what gets split.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" error={errors.label} wide>
            <input value={t.label} placeholder="Annual conference 2026" onChange={(e) => set({ label: e.target.value })} className={input("label")} />
          </Field>
          <Field label="Type">
            <select value={t.type} onChange={(e) => set({ type: e.target.value as Trip["type"] })} className={field}>
              <option value="conference">Conference</option>
              <option value="course">Course</option>
              <option value="exam">Exam</option>
            </select>
          </Field>
          <Field label="Where" error={errors.destination}>
            <input value={t.destination} placeholder="Melbourne" onChange={(e) => set({ destination: e.target.value })} className={input("destination")} />
          </Field>
          <Field label="Event starts" error={errors.workStart}>
            <input type="date" value={t.workStart} onChange={(e) => set({ workStart: e.target.value })} className={input("workStart")} />
          </Field>
          <Field label="Event ends" error={errors.workEnd}>
            <input type="date" value={t.workEnd} onChange={(e) => set({ workEnd: e.target.value })} className={input("workEnd")} />
          </Field>
          <Field label="Left home" error={errors.travelStart}>
            <input type="date" value={t.travelStart} onChange={(e) => set({ travelStart: e.target.value })} className={input("travelStart")} />
          </Field>
          <Field label="Got home" error={errors.travelEnd}>
            <input type="date" value={t.travelEnd} onChange={(e) => set({ travelEnd: e.target.value })} className={input("travelEnd")} />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={t.accompanied} onChange={(e) => set({ accompanied: e.target.checked })} className="h-4 w-4 accent-emerald-800" />
            Family or partner came along
          </label>
          <Field label="Notes (optional)" wide>
            <textarea rows={2} value={t.notes} onChange={(e) => set({ notes: e.target.value })} className={field} />
          </Field>
        </div>

        {showErrors && Object.keys(errors).length > 0 && (
          <p className="mt-3 text-sm text-red-700">Fix the highlighted fields.</p>
        )}
        <div className="flex gap-3 pt-4">
          <button type="button" onClick={save} className="rounded-lg bg-emerald-800 px-4 py-2.5 font-medium text-white hover:bg-emerald-900">
            Save trip
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2.5 font-medium text-slate-600 hover:text-slate-900">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, error, wide, children }: { label: string; error?: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={`text-sm ${wide ? "col-span-2" : ""}`}>
      <span className="mb-1 block text-slate-600">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </label>
  );
}
