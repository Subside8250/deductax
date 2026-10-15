import { useRef, useState, type ReactNode } from "react";
import { Check, CircleAlert, FileText, ImagePlus, LoaderCircle, NotebookPen, Plane, Plus, Sparkles, Trash2, X } from "lucide-react";
import { EXPENSE_KINDS, SECTIONS, money, sectionByCode, sectionLabel } from "../lib/sections";
import {
  activeTripSplit, buildSplit, canClaimPart, parseAmount, validate, validateReminder,
  type Draft, type DraftForm, type TripSplitState,
} from "../lib/draft";
import { TRAVEL_KINDS, needsSolo } from "../lib/tripSplit";
import { useStoredFile } from "../lib/useStoredFile";
import type { ExpenseRecord, Trip } from "../lib/types";

const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-emerald-700 focus:outline-none";
const fieldError = "border-red-500";

type Props = {
  draft: Draft;
  existing: ExpenseRecord | null;
  trips: Trip[];
  busy: boolean;
  onChange: (draft: Draft) => void;
  onPickTrip: (tripId: string | null) => void;
  onNewTrip: () => void;
  onAttach: (file: File) => void;
  onReadAI: () => void;
  onFile: (status: "filed" | "awaiting") => void;
  onDiscard: () => void;
  onDelete: () => void;
};

const confidenceStyles = {
  high: "bg-emerald-50 text-emerald-800 border-emerald-200",
  medium: "bg-amber-50 text-amber-800 border-amber-200",
  low: "bg-amber-100 text-amber-900 border-amber-300",
};

export default function ReviewCard({
  draft, existing, trips, busy, onChange, onPickTrip, onNewTrip, onAttach, onReadAI, onFile, onDiscard, onDelete,
}: Props) {
  const [showErrors, setShowErrors] = useState(false);
  const [viewing, setViewing] = useState(false);
  const attachRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileState = useStoredFile(draft.imageId);
  const attachment = fileState?.status === "ready" ? fileState : null;

  const f = draft.form;
  const isReminder = draft.status === "awaiting";
  const errors = showErrors ? (isReminder ? validateReminder(f) : validate(draft, trips)) : {};
  const update = (patch: Partial<DraftForm>) => onChange({ ...draft, form: { ...f, ...patch } });
  const ts = activeTripSplit(draft);
  const updateSplit = (patch: Partial<TripSplitState>) => ts && onChange({ ...draft, tripSplit: { ...ts, ...patch } });
  const trip = trips.find((t) => t.id === draft.tripId) ?? null;
  // No section field reports location, so this stands in for "out of area, no trip" (§5):
  // travel spending the reader filed as work travel or self-education.
  const askTrip = !trip && TRAVEL_KINDS.has(f.expenseKind) && (f.section === "D2" || f.section === "D4");
  const total = parseAmount(f.total) || 0;

  // Filing needs the full set; keeping it as a reminder only needs enough to recognise it.
  const submit = (status: "filed" | "awaiting") => {
    const problems = status === "awaiting" ? validateReminder(f) : validate(draft, trips);
    if (Object.keys(problems).length) {
      setShowErrors(true);
      // Let the error text render, then bring the first problem into view.
      requestAnimationFrame(() =>
        cardRef.current?.querySelector("[aria-invalid='true']")?.scrollIntoView({ behavior: "smooth", block: "center" })
      );
      return;
    }
    onFile(status);
  };

  const reasonLabel =
    f.section === "PERSONAL" ? "Why it isn't deductible"
    : f.section === "REVIEW" ? "What's unclear"
    : "Why this label";

  const reasonPlaceholder =
    f.section === "PERSONAL" ? "e.g. Ordinary clothing — would be bought regardless of the job."
    : f.section === "REVIEW" ? "e.g. Not sure whether this night falls inside the conference dates."
    : "e.g. Annual professional registration, required for the job.";

  const split = buildSplit(draft);
  const isImage = attachment?.file.type.startsWith("image/");
  const ex = draft.extraction;
  const reading = ex?.status === "reading";
  const readByAI = ex?.status === "done" && ex.source === "ai";

  return (
    <div ref={cardRef} className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 className="font-semibold">
          {isReminder ? (draft.isNew ? "Note for later" : "Waiting for its receipt") : draft.isNew ? "New expense" : "Edit expense"}
        </h2>
        {ex?.status === "done" && (
          <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${confidenceStyles[draft.confidence]}`}>
            {draft.confidence} confidence
          </span>
        )}
      </div>

      {isReminder && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-stone-50 px-4 py-3 text-sm text-slate-700">
          A note to yourself. Enter whatever you know now; it stays out of your totals until you add the receipt and file it.
        </div>
      )}

      {reading && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-stone-50 px-4 py-3 text-sm text-slate-700">
          <LoaderCircle size={16} className="shrink-0 animate-spin" /> Reading the receipt…
        </div>
      )}
      {ex?.status === "failed" && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          <span>{ex.message} You can fill it in by hand.</span>
        </div>
      )}
      {ex?.status === "done" && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {ex.source === "ai"
            ? `Filled in by AI${ex.model ? ` (${ex.model})` : ""}${ex.detail ? ` from ${ex.detail}` : ""}. Check every field before filing.`
            : ex.matched
              ? "Read from the PDF on this device, no AI used. Check every field before filing."
              : "Read the amounts and dates from the PDF, but couldn't tell what it's for. Fill in the rest, or read it with AI."}
          {readByAI && f.claim === "part" && !f.basis.trim() && (
            <span className="mt-1 block">Claude suggested claiming {f.percent}%. Add how you arrived at it, or switch to Claim all.</span>
          )}
        </div>
      )}

      {/* Attachment */}
      <div className="mb-4">
        {draft.imageId ? (
          attachment ? (
            isImage ? (
              <button type="button" onClick={() => setViewing(true)} className="block w-full" aria-label="View receipt full size">
                <img src={attachment.url} alt="Receipt" className="max-h-64 w-full rounded-lg bg-stone-100 object-contain" />
              </button>
            ) : (
              <a href={attachment.url} target="_blank" rel="noreferrer"
                className="flex items-center gap-3 rounded-lg bg-stone-100 px-3 py-3 text-sm hover:bg-stone-200">
                <FileText size={20} className="shrink-0 text-slate-600" />
                <span className="min-w-0 flex-1 truncate font-medium">{attachment.file.name}</span>
                <span className="shrink-0 text-slate-500">{(attachment.file.size / 1024).toFixed(0)} KB</span>
              </a>
            )
          ) : fileState?.status === "missing" ? (
            <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
              The receipt isn't on this device yet. It will download from Dropbox when you're online.
            </div>
          ) : (
            <div className="h-24 animate-pulse rounded-lg bg-stone-100" />
          )
        ) : (
          <div className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">
            No receipt attached
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
          <button type="button" onClick={() => attachRef.current?.click()} disabled={busy || reading}
            className="flex items-center gap-1.5 text-sm font-medium text-emerald-800 hover:text-emerald-950 disabled:opacity-50">
            <ImagePlus size={15} /> {draft.imageId ? "Replace receipt" : "Attach photo or PDF"}
          </button>
          {draft.imageId && (
            <button type="button" onClick={onReadAI} disabled={busy || reading}
              className="flex items-center gap-1.5 text-sm font-medium text-emerald-800 hover:text-emerald-950 disabled:opacity-50">
              <Sparkles size={15} /> {readByAI ? "Read again" : "Read with AI"}
            </button>
          )}
        </div>
        <input ref={attachRef} type="file" accept="image/*,application/pdf" className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onAttach(file);
          }} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Field label="Who you paid" error={errors.vendor} wide>
          <input value={f.vendor} onChange={(e) => update({ vendor: e.target.value })}
            aria-invalid={!!errors.vendor} className={`${field} ${errors.vendor ? fieldError : ""}`} />
        </Field>
        <Field label="Date" error={errors.date}>
          <input type="date" value={f.date} onChange={(e) => update({ date: e.target.value })}
            aria-invalid={!!errors.date} className={`${field} ${errors.date ? fieldError : ""}`} />
        </Field>
        <Field label="Total paid" error={errors.total}>
          <input inputMode="decimal" value={f.total} placeholder="0.00" onChange={(e) => update({ total: e.target.value })}
            aria-invalid={!!errors.total} className={`${field} ${errors.total ? fieldError : ""}`} />
        </Field>
        <Field label="What it was for" wide>
          <input value={f.description} onChange={(e) => update({ description: e.target.value })} className={field} />
        </Field>
        <Field label="Kind of expense">
          <select value={f.expenseKind} onChange={(e) => update({ expenseKind: e.target.value as DraftForm["expenseKind"] })} className={field}>
            {EXPENSE_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="GST" error={errors.gst}>
          <input inputMode="decimal" value={f.gst} placeholder="0.00" onChange={(e) => update({ gst: e.target.value })}
            aria-invalid={!!errors.gst} className={`${field} ${errors.gst ? fieldError : ""}`} />
        </Field>

        {f.expenseKind === "accommodation" && (
          <>
            <Field label="Check in">
              <input type="date" value={f.checkIn} onChange={(e) => update({ checkIn: e.target.value })} className={field} />
            </Field>
            <Field label="Check out" error={errors.checkOut}>
              <input type="date" value={f.checkOut} onChange={(e) => update({ checkOut: e.target.value })}
                aria-invalid={!!errors.checkOut} className={`${field} ${errors.checkOut ? fieldError : ""}`} />
            </Field>
          </>
        )}

        <Field label="Goes on your return at" error={errors.section} wide>
          <select value={f.section} onChange={(e) => update({ section: e.target.value as DraftForm["section"] })}
            aria-invalid={!!errors.section} className={`${field} ${errors.section ? fieldError : ""}`}>
            <option value="" disabled>Choose a label</option>
            {SECTIONS.map((s) => <option key={s.code} value={s.code}>{sectionLabel(s.code)}</option>)}
          </select>
          {f.section && <span className="mt-1 block text-xs text-slate-500">{sectionByCode(f.section).hint}</span>}
        </Field>

        <Field label={reasonLabel} error={errors.note} wide>
          <textarea rows={2} value={f.note} placeholder={reasonPlaceholder} onChange={(e) => update({ note: e.target.value })}
            aria-invalid={!!errors.note} className={`${field} ${errors.note ? fieldError : ""}`} />
        </Field>
      </div>

      {/* Trip */}
      <div className={`mb-4 rounded-xl p-3 ${askTrip ? "border border-amber-300 bg-amber-50" : "bg-stone-100"}`}>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Plane size={15} /> {askTrip ? "Which trip was this for?" : "Trip"}
        </div>
        <div className="flex gap-2">
          <select value={draft.tripId ?? ""} onChange={(e) => onPickTrip(e.target.value || null)} aria-label="Trip"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base">
            <option value="">Not part of a trip</option>
            {[...trips].sort((a, b) => b.travelStart.localeCompare(a.travelStart)).map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <button type="button" onClick={onNewTrip}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:border-slate-400">
            <Plus size={14} /> New
          </button>
        </div>
        {trip && (
          <p className="mt-2 text-xs text-slate-600">
            {trip.destination} · event {trip.workStart} to {trip.workEnd} · away {trip.travelStart} to {trip.travelEnd}
            {draft.tripLink === "auto" ? `. Linked because ${f.date} falls within the trip.` : ""}
          </p>
        )}
        {askTrip && (
          <p className="mt-2 text-xs text-amber-900">
            This looks like travel for a conference, course or exam. Pick the trip, or add it, so the claimable days can be worked out.
          </p>
        )}
        {needsSolo(trip, f.expenseKind) && f.section !== "PERSONAL" && (
          <div className="mt-3">
            <Field label="Cost if you'd travelled alone" error={errors.soloEquivalent}>
              <input inputMode="decimal" value={f.soloEquivalent} placeholder="e.g. single room rate" onChange={(e) => update({ soloEquivalent: e.target.value })}
                aria-invalid={!!errors.soloEquivalent} className={`${field} ${errors.soloEquivalent ? fieldError : ""}`} />
              <span className="mt-1 block text-xs text-slate-500">Family came along, so only what a solo trip would have cost is claimable.</span>
            </Field>
          </div>
        )}
      </div>

      {/* Trip split */}
      {ts && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="mb-2 text-sm font-medium text-amber-900">Suggested split — check it before filing</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Claim" error={errors.tripClaim}>
              <input inputMode="decimal" value={ts.claim} onChange={(e) => updateSplit({ claim: e.target.value })}
                aria-invalid={!!errors.tripClaim} className={`${field} ${errors.tripClaim ? fieldError : ""}`} />
            </Field>
            <div className="text-sm">
              <span className="mb-1 block text-slate-600">Private</span>
              <div className="rounded-lg bg-white/70 px-3 py-2 text-base font-medium">{money(Math.max(0, total - (parseAmount(ts.claim) || 0)))}</div>
            </div>
            <Field label="Why" error={errors.tripBasis} wide>
              <textarea rows={3} value={ts.basis} onChange={(e) => updateSplit({ basis: e.target.value })}
                aria-invalid={!!errors.tripBasis} className={`${field} ${errors.tripBasis ? fieldError : ""}`} />
            </Field>
          </div>
          {Math.abs((parseAmount(ts.claim) || 0) - ts.proposed) >= 0.005 && (
            <button type="button" onClick={() => updateSplit({ claim: ts.proposed.toFixed(2) })}
              className="mt-2 text-sm font-medium text-amber-900 underline">
              Reset to suggested {money(ts.proposed)}
            </button>
          )}
          {f.expenseKind === "airfare" && (
            <p className="mt-2 text-xs leading-relaxed text-amber-800">
              Flight percentages follow the ATO's stated general approach, not a rule in the legislation. A given trip is worth confirming with your accountant.
            </p>
          )}
          <label className="mt-3 flex items-center gap-2 text-sm font-medium text-amber-900">
            <input type="checkbox" checked={ts.confirmed} onChange={(e) => updateSplit({ confirmed: e.target.checked })}
              aria-invalid={!!errors.tripConfirm} className="h-4 w-4 accent-emerald-800" />
            I've checked this split
          </label>
          {errors.tripConfirm && <span className="mt-1 block text-xs text-red-700">{errors.tripConfirm}</span>}
        </div>
      )}

      {/* Claim */}
      {canClaimPart(draft) && (
        <div className="mb-4 rounded-xl bg-stone-100 p-3">
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-stone-200 p-1 text-sm font-medium" role="radiogroup" aria-label="How much to claim">
            {(["all", "part"] as const).map((c) => (
              <button key={c} type="button" role="radio" aria-checked={f.claim === c} onClick={() => update({ claim: c })}
                className={`rounded-md px-3 py-2 ${f.claim === c ? "bg-white shadow-sm" : "text-slate-600"}`}>
                {c === "all" ? "Claim all" : "Claim part"}
              </button>
            ))}
          </div>
          {f.claim === "part" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Work use %" error={errors.percent}>
                <input inputMode="decimal" value={f.percent} placeholder="e.g. 35" onChange={(e) => update({ percent: e.target.value })}
                  aria-invalid={!!errors.percent} className={`${field} ${errors.percent ? fieldError : ""}`} />
              </Field>
              <div className="text-sm">
                <span className="mb-1 block text-slate-600">You can claim</span>
                <div className="rounded-lg bg-white/70 px-3 py-2 text-base font-medium">{money(split.claimable)}</div>
              </div>
              <Field label="How you arrived at the percentage" error={errors.basis} wide>
                <textarea rows={2} value={f.basis} placeholder="e.g. 4-week diary, 35% work calls" onChange={(e) => update({ basis: e.target.value })}
                  aria-invalid={!!errors.basis} className={`${field} ${errors.basis ? fieldError : ""}`} />
              </Field>
            </div>
          ) : (
            <p className="text-sm text-slate-600">The full {money(split.claimable)} is claimed.</p>
          )}
        </div>
      )}
      {f.section === "PERSONAL" && (
        <p className="mb-4 rounded-xl bg-stone-100 p-3 text-sm text-slate-600">Kept for your records. Nothing is claimed.</p>
      )}

      {showErrors && Object.keys(errors).length > 0 && (
        <p className="mb-3 text-sm text-red-700">Fix the highlighted fields before filing.</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {isReminder ? (
          <>
            <button type="button" onClick={() => submit("awaiting")} disabled={busy}
              className="flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 font-medium text-white hover:bg-emerald-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-50">
              <NotebookPen size={16} /> {draft.isNew ? "Save reminder" : "Keep waiting"}
            </button>
            <button type="button" onClick={() => submit("filed")} disabled={busy}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 font-medium hover:border-slate-400 disabled:opacity-50">
              <Check size={16} /> File it now
            </button>
          </>
        ) : (
          <button type="button" onClick={() => submit("filed")} disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 font-medium text-white hover:bg-emerald-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-50">
            <Check size={16} /> {draft.isNew ? "File it" : "Save changes"}
          </button>
        )}
        <button type="button" onClick={onDiscard} className="rounded-lg px-4 py-2.5 font-medium text-slate-600 hover:text-slate-900">
          {draft.isNew ? "Discard" : "Cancel"}
        </button>
        {!draft.isNew && (
          <button type="button" onClick={onDelete} aria-label="Delete this record"
            className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium text-red-700 hover:text-red-900">
            <Trash2 size={15} /> Delete
          </button>
        )}
      </div>

      {existing && (
        <details className="mt-5 text-xs text-slate-500">
          <summary className="cursor-pointer">Stored record</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-stone-100 p-3">{JSON.stringify(existing, null, 2)}</pre>
        </details>
      )}

      {viewing && attachment && isImage && (
        <div className="fixed inset-0 z-50 bg-black/90" onClick={() => setViewing(false)}>
          <img src={attachment.url} alt="Receipt" className="h-full w-full object-contain" />
          <button type="button" onClick={() => setViewing(false)} aria-label="Close"
            className="absolute right-4 top-4 rounded-full bg-white/15 p-2 text-white">
            <X size={22} />
          </button>
        </div>
      )}
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
