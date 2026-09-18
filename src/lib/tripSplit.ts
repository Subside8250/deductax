import { proposeSplit } from "./apportion";
import { money, todayISO, within } from "./sections";
import type { ExpenseKind, ExpenseRecord, SectionCode, Split, Trip } from "./types";

// Expense kinds the engine apportions by trip (§4.1, §4.2).
export const TRAVEL_KINDS = new Set<ExpenseKind>(["airfare", "accommodation", "meal", "ground_transport"]);
// Kinds that prompt for a solo-equivalent cost when family came along (§4.3).
const SOLO_KINDS = new Set<ExpenseKind>(["airfare", "accommodation", "ground_transport"]);

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const blankTrip = (date = todayISO()): Trip => ({
  id: crypto.randomUUID(),
  label: "",
  type: "conference",
  destination: "",
  workStart: date,
  workEnd: date,
  travelStart: date,
  travelEnd: date,
  accompanied: false,
  notes: "",
});

export const tripForDate = (trips: Trip[], date: string) =>
  [...trips]
    .sort((a, b) => a.travelStart.localeCompare(b.travelStart))
    .find((t) => within(date, t.travelStart, t.travelEnd)) ?? null;

export const needsSolo = (trip: Trip | null, kind: ExpenseKind) => !!trip?.accompanied && SOLO_KINDS.has(kind);

export type SplitFacts = {
  total: number;
  expenseKind: ExpenseKind;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  soloEquivalent: number | null;
};

// The engine's proposal for a travel expense on a trip, with the accompanied-travel cap
// applied on top. Null when the expense isn't apportioned by trip.
export function proposeTripSplit(f: SplitFacts, trip: Trip): Split | null {
  if (!TRAVEL_KINDS.has(f.expenseKind) || !(f.total > 0)) return null;
  const base = proposeSplit(f, trip);
  if (base.method === "full") return null;
  if (!needsSolo(trip, f.expenseKind)) return base;

  const solo = f.soloEquivalent;
  if (!solo || !(solo > 0)) {
    return { ...base, basis: `${base.basis} Family travelled too: enter what this would have cost travelling alone.` };
  }
  if (solo >= f.total) {
    return { ...base, basis: `${base.basis} The solo-equivalent cost is the full amount, so family travel doesn't reduce it.` };
  }
  const claimable = round2((base.claimable * solo) / f.total);
  return {
    ...base,
    claimable,
    private: round2(f.total - claimable),
    basis: `${base.basis} Capped at the solo-equivalent cost of ${money(solo)}, since family travelled too; the rest is private.`,
  };
}

// §4.2: a flight whose private purpose dominates goes to review, not to PERSONAL.
export const isZeroAirfare = (kind: ExpenseKind, split: Split) =>
  kind === "airfare" && split.method === "percent" && split.claimable === 0;
export const ZERO_AIRFARE_NOTE =
  "The private part of this trip looks longer than the work part, so the flight may not be claimable. Decide how much, if any, relates to the conference, course or exam.";

const toReview = (section: SectionCode) => section === "D2" || section === "D4";

export const hasTripSplit = (r: ExpenseRecord) => !!r.tripId && TRAVEL_KINDS.has(r.expenseKind) && r.split.method !== "full";

const factsOf = (r: ExpenseRecord): SplitFacts => ({
  total: r.total,
  expenseKind: r.expenseKind,
  date: r.date,
  checkIn: r.checkIn,
  checkOut: r.checkOut,
  soloEquivalent: r.soloEquivalent ?? null,
});

// Detaches a record from its trip. A split that came from the trip no longer has a
// basis, so it reverts to a full claim flagged for the user to check.
function unlinked(r: ExpenseRecord, now: string): ExpenseRecord {
  return {
    ...r,
    tripId: null,
    split: hasTripSplit(r) ? { method: "full", claimable: r.total, private: 0, basis: "", confirmed: false } : r.split,
    updatedAt: now,
  };
}

const datesOrPartyChanged = (a: Trip, b: Trip) =>
  a.workStart !== b.workStart ||
  a.workEnd !== b.workEnd ||
  a.travelStart !== b.travelStart ||
  a.travelEnd !== b.travelEnd ||
  a.accompanied !== b.accompanied;

// After a trip is saved: links unlinked records dated inside its travel window, detaches
// records that now fall outside it, and re-proposes splits — unconfirmed — for records
// that were just linked or whose trip dates changed. Returns only the records that changed.
export function relinkRecords(records: ExpenseRecord[], trip: Trip, previous: Trip | null): ExpenseRecord[] {
  const now = new Date().toISOString();
  const repropose = !previous || datesOrPartyChanged(previous, trip);
  const changed: ExpenseRecord[] = [];

  for (const r of records) {
    const inside = within(r.date, trip.travelStart, trip.travelEnd);
    if (r.tripId === trip.id && !inside) {
      changed.push(unlinked(r, now));
      continue;
    }
    if (!inside || (r.tripId && r.tripId !== trip.id)) continue;

    const newlyLinked = r.tripId !== trip.id;
    const proposal = newlyLinked || repropose ? proposeTripSplit(factsOf(r), trip) : null;
    if (!newlyLinked && !proposal) continue;

    let next: ExpenseRecord = { ...r, tripId: trip.id, updatedAt: now };
    if (proposal) {
      next.split = { ...proposal, confirmed: false };
      if (isZeroAirfare(r.expenseKind, proposal) && toReview(r.section)) {
        next = { ...next, section: "REVIEW", note: `${ZERO_AIRFARE_NOTE} ${r.note}`.trim() };
      }
    }
    changed.push(next);
  }
  return changed;
}

export const unlinkTrip = (records: ExpenseRecord[], tripId: string) => {
  const now = new Date().toISOString();
  return records.filter((r) => r.tripId === tripId).map((r) => unlinked(r, now));
};
