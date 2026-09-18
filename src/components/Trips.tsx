import { ArrowLeft, CircleAlert, Pencil, Plane, Plus, Printer, Trash2 } from "lucide-react";
import { EXPENSE_KINDS, daysBetween, money } from "../lib/sections";
import { claimableOf, privateOf, sum } from "../lib/totals";
import { needsSolo } from "../lib/tripSplit";
import type { ExpenseRecord, Trip } from "../lib/types";

const kindName = new Map(EXPENSE_KINDS);
const typeName = { conference: "Conference", course: "Course", exam: "Exam" };

const dateRange = (a: string, b: string) => (a === b ? a : `${a} to ${b}`);

export function TripList({ trips, records, onOpen, onNew, onBack }: {
  trips: Trip[];
  records: ExpenseRecord[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onBack: () => void;
}) {
  const sorted = [...trips].sort((a, b) => b.travelStart.localeCompare(a.travelStart));
  return (
    <div>
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft size={15} /> Back
      </button>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Trips</h2>
        <button type="button" onClick={onNew}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-800 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-900">
          <Plus size={15} /> Add a trip
        </button>
      </div>
      {!sorted.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center text-sm text-slate-500">
          No trips yet. Add conferences, courses and exams you travelled for, and receipts dated during them are linked automatically.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {sorted.map((t) => {
            const linked = records.filter((r) => r.tripId === t.id);
            const unconfirmed = linked.filter((r) => !r.split.confirmed).length;
            return (
              <li key={t.id}>
                <button type="button" onClick={() => onOpen(t.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-stone-50">
                  <Plane size={16} className="mt-1 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{t.label}</div>
                    <div className="truncate text-sm text-slate-500">
                      {t.destination} · {dateRange(t.workStart, t.workEnd)}
                    </div>
                    {unconfirmed > 0 && (
                      <div className="mt-1 text-xs font-medium text-amber-800">
                        {unconfirmed} split{unconfirmed === 1 ? "" : "s"} to confirm
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <div className="font-medium">{money(sum(linked.map(claimableOf)))}</div>
                    <div className="text-xs text-slate-500">{linked.length} receipt{linked.length === 1 ? "" : "s"}</div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// §5 trip summary: every record on the trip, claimable against private, and warnings
// for anything not yet confirmed.
export function TripSummary({ trip, records, onBack, onEdit, onDelete, onOpenRecord, onDiary }: {
  trip: Trip;
  records: ExpenseRecord[];
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenRecord: (r: ExpenseRecord) => void;
  onDiary: () => void;
}) {
  const linked = records.filter((r) => r.tripId === trip.id).sort((a, b) => a.date.localeCompare(b.date));
  const airfareUnconfirmed = linked.some((r) => r.expenseKind === "airfare" && !r.split.confirmed);
  const unconfirmed = linked.filter((r) => !r.split.confirmed).length;
  const soloMissing = linked.filter((r) => r.section !== "PERSONAL" && needsSolo(trip, r.expenseKind) && !r.soloEquivalent).length;
  const workDays = daysBetween(trip.workStart, trip.workEnd);
  const awayDays = daysBetween(trip.travelStart, trip.travelEnd);

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft size={15} /> Trips
      </button>

      <div className="mb-4 rounded-2xl border border-slate-300 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{trip.label}</h2>
            <p className="text-sm text-slate-600">{typeName[trip.type]} · {trip.destination}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <button type="button" onClick={onEdit} aria-label="Edit trip" className="rounded-lg p-2 text-slate-500 hover:bg-stone-100 hover:text-slate-900">
              <Pencil size={16} />
            </button>
            <button type="button" onClick={onDelete} aria-label="Delete trip" className="rounded-lg p-2 text-slate-500 hover:bg-stone-100 hover:text-red-700">
              <Trash2 size={16} />
            </button>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">Event</dt>
          <dd>{dateRange(trip.workStart, trip.workEnd)} ({workDays} day{workDays === 1 ? "" : "s"})</dd>
          <dt className="text-slate-500">Away from home</dt>
          <dd>{dateRange(trip.travelStart, trip.travelEnd)} ({awayDays} day{awayDays === 1 ? "" : "s"})</dd>
          {trip.accompanied && (
            <>
              <dt className="text-slate-500">Travelling with</dt>
              <dd>Family or partner</dd>
            </>
          )}
        </dl>
        {trip.notes && <p className="mt-3 text-sm text-slate-600">{trip.notes}</p>}

        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-200 pt-4">
          <div>
            <div className="text-sm text-slate-500">Claimable</div>
            <div className="text-2xl font-semibold">{money(sum(linked.filter((r) => r.section !== "REVIEW").map(claimableOf)))}</div>
          </div>
          <div>
            <div className="text-sm text-slate-500">Private</div>
            <div className="text-2xl font-semibold text-slate-500">{money(sum(linked.map(privateOf)))}</div>
          </div>
        </div>
        <button type="button" onClick={onDiary}
          className="mt-4 flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:border-slate-400">
          <Printer size={15} /> Travel diary
        </button>
      </div>

      {(airfareUnconfirmed || unconfirmed > 0 || soloMissing > 0) && (
        <div className="mb-4 space-y-1 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {airfareUnconfirmed && (
            <p className="flex items-start gap-2">
              <CircleAlert size={16} className="mt-0.5 shrink-0" />
              <span>
                A flight on this trip has no confirmed split. Flight percentages follow the ATO's stated general approach, not a rule in the legislation. Worth confirming with your accountant.
              </span>
            </p>
          )}
          {unconfirmed > 0 && (
            <p className="flex items-start gap-2">
              <CircleAlert size={16} className="mt-0.5 shrink-0" />
              <span>{unconfirmed} split{unconfirmed === 1 ? " is" : "s are"} waiting for you to check. Tap a receipt below to confirm it.</span>
            </p>
          )}
          {soloMissing > 0 && (
            <p className="flex items-start gap-2">
              <CircleAlert size={16} className="mt-0.5 shrink-0" />
              <span>{soloMissing} receipt{soloMissing === 1 ? " needs" : "s need"} the cost of travelling alone.</span>
            </p>
          )}
        </div>
      )}

      {!linked.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-8 text-center text-sm text-slate-500">
          No receipts on this trip yet. Receipts dated {dateRange(trip.travelStart, trip.travelEnd)} are linked automatically.
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {linked.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onOpenRecord(r)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-stone-50">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{r.vendor}</div>
                  <div className="truncate text-sm text-slate-500">
                    {r.date} · {kindName.get(r.expenseKind)} · {r.section === "PERSONAL" ? "Not deductible" : r.section === "REVIEW" ? "Needs review" : r.section}
                  </div>
                  {!r.split.confirmed && <div className="mt-1 text-xs font-medium text-amber-800">Split not confirmed</div>}
                </div>
                <div className="shrink-0 text-right text-sm">
                  <div className="font-medium">{money(claimableOf(r))}</div>
                  {claimableOf(r) !== r.total && <div className="text-xs text-slate-500">of {money(r.total)}</div>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
