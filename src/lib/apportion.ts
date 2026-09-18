import type { ExpenseKind, Split, Trip } from "./types";
import { daysBetween, within } from "./sections";

// Carried across from prototype.jsx unchanged apart from type annotations, except the
// airfare rule, which was brought in line with SPEC §4.2 and the ATO's examples (2026-09-17).

export type SplitInput = {
  total: number | string;
  expenseKind: ExpenseKind;
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
};

// ---------------------------------------------------------------------------
// Apportionment engine
// ---------------------------------------------------------------------------
export function proposeSplit(draft: SplitInput, trip: Trip | null): Split {
  const total = Number(draft.total) || 0;
  const full: Split = { method: "full", claimable: total, private: 0, basis: "", confirmed: true };
  if (!trip) return full;

  const workDays = daysBetween(trip.workStart, trip.workEnd);
  const travelDays = daysBetween(trip.travelStart, trip.travelEnd);

  // A night is claimable if it is necessarily incurred to attend: the night
  // before the event starts (you cannot be there for a morning start otherwise)
  // through to the night of the final day (flying home the next morning).
  const shiftDate = (iso: string, days: number) => {
    const d = new Date(iso);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const claimFrom = shiftDate(trip.workStart, -1);
  const claimTo = trip.workEnd;

  // Days away that are necessary to attend are not private: the event itself, plus the
  // day before or after it only when that is the day the trip starts or ends. A day
  // before or after spent on holiday is private even if it ends in a flight (the ATO's
  // examples count it that way). Changed from the prototype, which always allowed both.
  const necessaryDays =
    workDays + (trip.travelStart === claimFrom ? 1 : 0) + (trip.travelEnd === shiftDate(trip.workEnd, 1) ? 1 : 0);
  const privateDays = Math.max(0, travelDays - necessaryDays);

  if (draft.expenseKind === "accommodation") {
    const checkIn = draft.checkIn || draft.date;
    const checkOut = draft.checkOut || draft.date;
    const nights = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000));
    let workNights = 0;
    for (let i = 0; i < nights; i++) {
      const d = shiftDate(checkIn, i);
      if (within(d, claimFrom, claimTo)) workNights++;
    }
    const rate = total / nights;
    const extra = nights - workNights;
    return {
      method: "nights",
      claimable: +(rate * workNights).toFixed(2),
      private: +(rate * extra).toFixed(2),
      basis:
        `${workNights} of ${nights} night${nights === 1 ? "" : "s"} treated as claimable for ${trip.label} — the event runs ${trip.workStart} to ${trip.workEnd}, plus the night before it starts as a necessary travel night.` +
        (extra > 0 ? ` ${extra} night${extra === 1 ? "" : "s"} sit outside that and are treated as private.` : ""),
      confirmed: false,
    };
  }

  if (draft.expenseKind === "airfare") {
    // §4.2: incidental private days keep the full fare. A dual-purpose trip (more than
    // half, up to 1.5x the event days) is split by day count, event days over event plus
    // private days, as in the ATO's examples (3 + 3 days = 50%, 10 + 15 days = 40%).
    // Beyond that private purpose dominates. The prototype applied a flat 50% from 20%
    // of the trip, which split trips that were plainly mainly for work.
    let pct: number, why: string;
    if (privateDays <= 1 || privateDays / travelDays < 0.2 || privateDays <= workDays / 2) {
      pct = 100;
      why = `${privateDays} private day${privateDays === 1 ? "" : "s"} against ${workDays} work days — private portion looks incidental.`;
    } else if (privateDays <= workDays * 1.5) {
      pct = +((workDays / (workDays + privateDays)) * 100).toFixed(1);
      why = `${privateDays} private days against ${workDays} work days — a dual-purpose trip, so the flight is split by day count: ${workDays} of ${workDays + privateDays} days.`;
    } else {
      pct = 0;
      why = `${privateDays} private days against ${workDays} work days — private purpose appears to dominate. Sent to review rather than written off.`;
    }
    return {
      method: "percent",
      claimable: +((total * pct) / 100).toFixed(2),
      private: +(total - +((total * pct) / 100).toFixed(2)).toFixed(2),
      basis: `Proposed ${pct}%. ${why}`,
      confirmed: false,
    };
  }

  if (["meal", "ground_transport"].includes(draft.expenseKind)) {
    const inWork = within(draft.date, claimFrom, shiftDate(trip.workEnd, 1));
    return {
      method: "manual",
      claimable: inWork ? total : 0,
      private: inWork ? 0 : total,
      basis: inWork
        ? `Incurred during ${trip.label}, counting the travel days either side of the event (${trip.workStart} to ${trip.workEnd}).`
        : `Dated outside the ${trip.label} work and travel days, so treated as private.`,
      confirmed: false,
    };
  }

  return full;
}
