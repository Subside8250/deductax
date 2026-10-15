import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Camera, CircleAlert, CircleCheck, FileText, PenLine, Plane, Settings as SettingsIcon, X } from "lucide-react";
import ReviewCard from "./components/ReviewCard";
import SectionList from "./components/SectionList";
import Settings from "./components/Settings";
import SyncBadge from "./components/SyncBadge";
import TripForm from "./components/TripForm";
import { TripList, TripSummary } from "./components/Trips";
import QuickNote from "./components/QuickNote";
import { SummaryReport, TripDiary } from "./components/Report";
import {
  clearDraft, deleteFile, deleteRecord, deleteTrip, listRecords, listTrips, loadDraft, putDraft, requestPersistence,
  saveFile, saveRecord, saveRecords, saveTrip,
} from "./lib/db";
import {
  adoptReminder, applyExtraction, draftFromRecord, newDraft, normalizeDraft, releaseReminder, syncTrip, toRecord, type Draft,
} from "./lib/draft";
import { bestReminderMatch, parseQuickNote } from "./lib/quickNote";
import { buildCsv, csvFileName, downloadCsv } from "./lib/exportCsv";
import { todayISO } from "./lib/sections";
import { availableYears, awaitingReceipts, fyOf, groupBySection } from "./lib/totals";
import { blankTrip, relinkRecords, unlinkTrip } from "./lib/tripSplit";
import type { ExpenseRecord, Trip } from "./lib/types";
import { useSync } from "./lib/useSync";

type View =
  | { name: "home" }
  | { name: "settings" }
  | { name: "trips" }
  | { name: "trip"; id: string }
  | { name: "report" }
  | { name: "diary"; id: string };
type TripEditor = { trip: Trip; isNew: boolean; forDraft: boolean };

const mergeById = <T extends { id: string }>(list: T[], changed: T[]) => {
  const ids = new Set(changed.map((c) => c.id));
  return [...list.filter((x) => !ids.has(x.id)), ...changed];
};

export default function App() {
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [fy, setFy] = useState(() => fyOf(todayISO()));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [view, setView] = useState<View>({ name: "home" });
  const [tripEditor, setTripEditor] = useState<TripEditor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Async reads finish later; they need the trips as they are then, not when they started.
  const tripsRef = useRef<Trip[]>([]);
  tripsRef.current = trips;
  const recordsRef = useRef<ExpenseRecord[]>([]);
  recordsRef.current = records;

  // After a sync, show what's now stored. An open card is left alone.
  const reloadData = async () => {
    const [r, t] = await Promise.all([listRecords(), listTrips()]);
    setRecords(r);
    setTrips(t);
    tripsRef.current = t;
  };
  const sync = useSync({ onSynced: reloadData, onNotice: setNotice });

  useEffect(() => {
    Promise.all([listRecords(), loadDraft(), listTrips()])
      .then(([r, d, t]) => {
        setRecords(r);
        setTrips(t);
        if (d) {
          d = normalizeDraft(d);
          // A read that was in flight when the tab closed won't finish; say so.
          if (d.extraction?.status === "reading") {
            d = { ...d, extraction: { status: "failed", message: "Reading was interrupted. Tap Read with AI to try again." } };
          }
        }
        setDraft(d ?? null);
        setLoaded(true);
      })
      .catch(() => setError("Couldn't open storage on this device. Records can't be saved until this is fixed."));
  }, []);

  // Keep the open review card in IndexedDB so it survives the tab being killed.
  useEffect(() => {
    if (!loaded) return;
    (draft ? putDraft(draft) : clearDraft()).catch(() => {});
  }, [draft, loaded]);

  const draftId = draft?.id;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [draftId, view]);

  // A notice belongs to the screen it was raised on.
  useEffect(() => setNotice(null), [view]);

  // Every change to the card goes through the trip sync, so the link and split follow it.
  const changeDraft = (next: Draft) => setDraft((prev) => (prev ? syncTrip(prev, next, tripsRef.current) : next));

  const store = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      return await saveFile(file);
    } catch {
      setError("Couldn't store that file on this device. You can still enter the details by hand.");
      return null;
    } finally {
      setBusy(false);
    }
  };

  // Reads the attached file into the card. The card stays usable throughout, and
  // the result is dropped if the user has moved on to a different card or file.
  const read = async (draftId: string, fileId: string, explicit: boolean) => {
    const current = (d: Draft | null) => d?.id === draftId && d.imageId === fileId;
    setDraft((d) => (current(d) ? { ...d!, extraction: { status: "reading" } } : d));
    try {
      const { readReceipt } = await import("./lib/extract");
      const result = await readReceipt(fileId, { forceAI: explicit });
      setDraft((d) => {
        if (!current(d)) return d;
        let next = syncTrip(d, applyExtraction(d!, result, explicit), tripsRef.current);
        // A new capture may complete a note made earlier.
        if (next.isNew && !next.matched) {
          const match = bestReminderMatch(recordsRef.current.filter((r) => r.status === "awaiting"), {
            vendor: next.form.vendor,
            total: Number(next.form.total.replace(/[$,\s]/g, "")) || null,
            date: next.form.date,
          });
          if (match) next = adoptReminder(next, match.record, match.why);
        }
        return next;
      });
    } catch (e) {
      const message = e instanceof Error && e.message ? e.message : "Couldn't read that one.";
      setDraft((d) => (current(d) ? { ...d!, extraction: { status: "failed", message } } : d));
    }
  };

  // A one-line note: saved straight away, no card.
  const addQuickNote = async (text: string) => {
    const { vendor, total, date } = parseQuickNote(text);
    const d = newDraft(null, "awaiting");
    const record = toRecord({ ...d, form: { ...d.form, vendor, date, total: total ? String(total) : "" } });
    try {
      await saveRecord(record);
      setRecords((rs) => mergeById(rs, [record]));
      setNotice(`Noted "${record.vendor}". It's waiting for its receipt.`);
      requestPersistence();
      sync.requestSync();
    } catch {
      setError("Couldn't save that note.");
    }
  };

  const startDraft = (stored: Awaited<ReturnType<typeof store>> = null, status: "filed" | "awaiting" = "filed") => {
    const d = syncTrip(null, newDraft(stored, status), trips);
    setDraft(d);
    setNotice(null);
    return d;
  };

  const startFromFile = async (file: File) => {
    // A storage failure still opens the card — the expense is never blocked.
    const stored = await store(file);
    const d = startDraft(stored);
    if (stored) read(d.id, stored.id, false);
  };

  const attach = async (file: File) => {
    if (!draft) return;
    const stored = await store(file);
    if (!stored) return;
    if (draft.imageId && draft.imageId !== draft.originalImageId) await deleteFile(draft.imageId);
    setDraft({ ...draft, imageId: stored.id, sourceFile: stored.name, extraction: undefined });
    read(draft.id, stored.id, false);
  };

  const fileDraft = async (status: "filed" | "awaiting") => {
    if (!draft) return;
    const record = toRecord({ ...draft, status });
    try {
      await saveRecord(record);
      if (draft.originalImageId && draft.originalImageId !== draft.imageId) await deleteFile(draft.originalImageId);
      setRecords((rs) => mergeById(rs, [record]));
      if (view.name === "home" && status === "filed") setFy(fyOf(record.date)); // show the year it was filed under
      setDraft(null);
      setError(null);
      requestPersistence();
      sync.requestSync();
    } catch {
      setError("Couldn't save that record. Your entry is still here — try again.");
    }
  };

  const discard = async () => {
    if (!draft) return;
    const losesNewFile = draft.imageId && draft.imageId !== draft.originalImageId;
    if (draft.isNew && losesNewFile && !window.confirm("Discard this expense? The attached receipt will be deleted.")) return;
    if (losesNewFile) await deleteFile(draft.imageId!).catch(() => {});
    setDraft(null);
    setError(null);
  };

  const remove = async () => {
    if (!draft || !window.confirm("Delete this record and its receipt? This can't be undone.")) return;
    try {
      await deleteRecord(draft.id);
      if (draft.imageId && draft.imageId !== draft.originalImageId) await deleteFile(draft.imageId);
      setRecords((rs) => rs.filter((r) => r.id !== draft.id));
      setDraft(null);
      sync.requestSync();
    } catch {
      setError("Couldn't delete that record.");
    }
  };

  const storeTrip = async (editor: TripEditor) => {
    const { isNew, forDraft } = editor;
    const trip = { ...editor.trip, updatedAt: new Date().toISOString() };
    const previous = isNew ? null : trips.find((t) => t.id === trip.id) ?? null;
    // Records open on the card are saved when the card is filed, not here.
    const changed = relinkRecords(records.filter((r) => r.id !== draft?.id), trip, previous);
    try {
      await saveTrip(trip);
      await saveRecords(changed);
    } catch {
      setError("Couldn't save that trip.");
      return;
    }
    const nextTrips = mergeById(trips, [trip]);
    setTrips(nextTrips);
    tripsRef.current = nextTrips;
    setRecords((rs) => mergeById(rs, changed));
    setTripEditor(null);
    sync.requestSync();
    if (draft) {
      setDraft(
        forDraft
          ? syncTrip(draft, { ...draft, tripId: trip.id, tripLink: "user" }, nextTrips)
          : // Re-propose against the edited trip.
            syncTrip({ ...draft, tripId: null }, draft, nextTrips)
      );
    }
    const linked = changed.filter((r) => r.tripId === trip.id).length;
    const detached = changed.length - linked;
    const parts = [
      linked && `${linked} earlier receipt${linked === 1 ? "" : "s"} linked or updated`,
      detached && `${detached} no longer inside the trip dates and unlinked`,
    ].filter(Boolean);
    setNotice(parts.length ? `${trip.label}: ${parts.join("; ")}. Check the splits in the trip summary.` : null);
  };

  const removeTrip = async (trip: Trip) => {
    const affected = unlinkTrip(records, trip.id);
    const message = affected.length
      ? `Delete ${trip.label}? ${affected.length} receipt${affected.length === 1 ? " stays" : "s stay"} filed but will no longer be linked, and any trip-based split will need checking.`
      : `Delete ${trip.label}?`;
    if (!window.confirm(message)) return;
    try {
      await saveRecords(affected);
      await deleteTrip(trip.id);
    } catch {
      setError("Couldn't delete that trip.");
      return;
    }
    setRecords((rs) => mergeById(rs, affected));
    setTrips((ts) => ts.filter((t) => t.id !== trip.id));
    setView({ name: "trips" });
    sync.requestSync();
  };

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again
    if (file) startFromFile(file);
  };

  const existing = draft && !draft.isNew ? records.find((r) => r.id === draft.id) ?? null : null;
  const openTrip = view.name === "trip" || view.name === "diary" ? trips.find((t) => t.id === view.id) ?? null : null;
  const onHome = !draft && view.name === "home";

  return (
    <div className="min-h-screen bg-stone-50 text-slate-900">
      <div className="mx-auto max-w-2xl px-4 pb-10 pt-6 sm:px-5 sm:pt-8">
        <header className="mb-6 print:hidden">
          <div className="flex items-center justify-between gap-3">
            <h1 className="mb-1 text-2xl font-semibold tracking-tight">Deduction capture</h1>
            {onHome && (
              <div className="flex gap-1">
                <button type="button" onClick={() => setView({ name: "trips" })} aria-label="Trips"
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 hover:bg-stone-200 hover:text-slate-900">
                  <Plane size={18} /> Trips
                </button>
                <button type="button" onClick={() => setView({ name: "settings" })} aria-label="Settings"
                  className="rounded-lg p-2 text-slate-500 hover:bg-stone-200 hover:text-slate-900">
                  <SettingsIcon size={20} />
                </button>
              </div>
            )}
          </div>
          {onHome && (
            <>
              <p className="text-sm text-slate-600">
                Photograph a receipt or drop in an invoice. It's read for you, and you check it before it's filed.
              </p>
              <div className="mt-1">
                <SyncBadge status={sync.status} onClick={() => setView({ name: "settings" })} />
              </div>
            </>
          )}
        </header>

        {error && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <CircleAlert size={16} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {notice && (
          <div className="mb-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <CircleCheck size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{notice}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="shrink-0">
              <X size={16} />
            </button>
          </div>
        )}

        {draft ? (
          <ReviewCard
            key={draft.id}
            draft={draft}
            existing={existing}
            trips={trips}
            busy={busy}
            onChange={changeDraft}
            onPickTrip={(tripId) => changeDraft({ ...draft, tripId, tripLink: "user" })}
            onUnmatch={() => setDraft(releaseReminder(draft))}
            onNewTrip={() => setTripEditor({ trip: blankTrip(draft.form.date || todayISO()), isNew: true, forDraft: true })}
            onAttach={attach}
            onReadAI={() => draft.imageId && read(draft.id, draft.imageId, true)}
            onFile={fileDraft}
            onDiscard={discard}
            onDelete={remove}
          />
        ) : view.name === "settings" ? (
          <Settings onClose={() => setView({ name: "home" })} sync={sync} />
        ) : view.name === "trips" ? (
          <TripList
            trips={trips}
            records={records}
            onOpen={(id) => setView({ name: "trip", id })}
            onNew={() => setTripEditor({ trip: blankTrip(), isNew: true, forDraft: false })}
            onBack={() => setView({ name: "home" })}
          />
        ) : view.name === "trip" && openTrip ? (
          <TripSummary
            trip={openTrip}
            records={records}
            onBack={() => setView({ name: "trips" })}
            onEdit={() => setTripEditor({ trip: openTrip, isNew: false, forDraft: false })}
            onDelete={() => removeTrip(openTrip)}
            onOpenRecord={(r) => setDraft(draftFromRecord(r))}
            onDiary={() => setView({ name: "diary", id: openTrip.id })}
          />
        ) : view.name === "diary" && openTrip ? (
          <TripDiary trip={openTrip} records={records} onBack={() => setView({ name: "trip", id: openTrip.id })} />
        ) : view.name === "report" ? (
          <SummaryReport records={records} trips={trips} fy={fy} awaiting={awaitingReceipts(records).length} onBack={() => setView({ name: "home" })} />
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy || !loaded}
                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-800 px-4 py-5 font-medium text-white hover:bg-emerald-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-50">
                <Camera size={18} /> Take a photo
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || !loaded}
                className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-5 font-medium hover:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-50">
                <FileText size={18} /> Choose a file
              </button>
            </div>
            <button type="button" onClick={() => startDraft()} disabled={!loaded}
              className="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:border-slate-400 disabled:opacity-50">
              <PenLine size={15} /> Enter without a receipt
            </button>
            <QuickNote onAdd={addQuickNote} disabled={!loaded} />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={pick} />

            {loaded && records.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center text-sm text-slate-500">
                Nothing filed yet. Your first receipt will appear here, sorted under its label.
              </div>
            ) : (
              loaded && (
                <SectionList
                  groups={groupBySection(records, fy)}
                  awaiting={awaitingReceipts(records)}
                  trips={trips}
                  years={availableYears(records, todayISO())}
                  fy={fy}
                  onYear={setFy}
                  onOpen={(r) => setDraft(draftFromRecord(r))}
                  onExport={() => downloadCsv(buildCsv(records, trips, fy), csvFileName(fy))}
                  onReport={() => setView({ name: "report" })}
                />
              )
            )}
          </>
        )}

        {tripEditor && (
          <TripForm
            key={tripEditor.trip.id}
            initial={tripEditor.trip}
            isNew={tripEditor.isNew}
            onSave={(trip) => storeTrip({ ...tripEditor, trip })}
            onCancel={() => setTripEditor(null)}
          />
        )}

        <p className="mt-10 text-xs leading-relaxed text-slate-500 print:hidden">
          {records.length} record{records.length === 1 ? "" : "s"} stored on this device.
          Suggestions are a starting point, not tax advice — confirm anything uncertain with your accountant.
        </p>
      </div>
    </div>
  );
}
