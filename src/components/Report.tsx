import { ArrowLeft, Printer } from "lucide-react";
import { EXPENSE_KINDS, money, sectionByCode } from "../lib/sections";
import { claimableOf, deductionTotal, fyLabel, fyRange, groupBySection, isDeductible, privateOf, sum } from "../lib/totals";
import { needsSolo } from "../lib/tripSplit";
import type { ExpenseRecord, Trip } from "../lib/types";

// Printable outputs (SPEC §9.3 and §9.4). The device's own Print → Save as PDF turns
// these into a file, so there's no PDF library and the text stays selectable.

const kindName = new Map(EXPENSE_KINDS);
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
// Stepped in UTC: parsing a plain date locally and formatting back through UTC can
// land on the previous day east of Greenwich, which never advances the loop below.
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

function PrintBar({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 print:hidden">
      <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft size={15} /> Back
      </button>
      <button type="button" onClick={() => window.print()}
        className="flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 font-medium text-white hover:bg-emerald-900">
        <Printer size={16} /> {label}
      </button>
    </div>
  );
}

const th = "border-b border-slate-300 py-1.5 pr-3 text-left font-semibold";
const td = "border-b border-slate-200 py-1.5 pr-3 align-top";

export function SummaryReport({ records, trips, fy, onBack }: { records: ExpenseRecord[]; trips: Trip[]; fy: number; onBack: () => void }) {
  const groups = groupBySection(records, fy);
  const claimable = groups.filter((g) => isDeductible(g.code));
  const review = groups.find((g) => g.code === "REVIEW");
  const personal = groups.find((g) => g.code === "PERSONAL");
  const { from, to } = fyRange(fy);
  const tripName = (id: string | null) => (id ? trips.find((t) => t.id === id)?.label ?? "" : "");

  return (
    <div>
      <PrintBar onBack={onBack} label="Print or save as PDF" />
      <article className="rounded-2xl border border-slate-300 bg-white p-5 text-sm print:border-0 print:p-0">
        <header className="mb-4">
          <h2 className="text-lg font-semibold">Work-related deductions — FY {fyLabel(fy)}</h2>
          <p className="text-slate-600">
            {longDate(from)} to {longDate(to)}. Prepared {longDate(new Date().toISOString().slice(0, 10))}.
          </p>
        </header>

        <h3 className="mb-1 font-semibold">Totals by tax return label</h3>
        <table className="mb-6 w-full">
          <thead>
            <tr><th className={th}>Label</th><th className={`${th} text-right`}>Claimable</th></tr>
          </thead>
          <tbody>
            {claimable.map((g) => (
              <tr key={g.code}>
                <td className={td}>{g.code} — {g.name}</td>
                <td className={`${td} text-right tabular-nums`}>{money(g.claimable)}</td>
              </tr>
            ))}
            <tr>
              <td className="py-2 pr-3 font-semibold">Total</td>
              <td className="py-2 pr-3 text-right font-semibold tabular-nums">{money(deductionTotal(groups))}</td>
            </tr>
          </tbody>
        </table>

        {claimable.map((g) => (
          <section key={g.code} className="mb-6 break-inside-avoid">
            <h3 className="mb-1 font-semibold">{g.code} — {g.name} · {money(g.claimable)}</h3>
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>Date</th><th className={th}>Paid to</th><th className={th}>What for</th>
                  <th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Claimed</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((r) => (
                  <tr key={r.id}>
                    <td className={`${td} whitespace-nowrap`}>{r.date}</td>
                    <td className={td}>{r.vendor}</td>
                    <td className={td}>
                      {r.description || kindName.get(r.expenseKind)}
                      {tripName(r.tripId) && <span className="text-slate-600"> · {tripName(r.tripId)}</span>}
                      {r.split.basis && <div className="text-slate-600">{r.split.basis}</div>}
                      {!r.split.confirmed && <div className="font-medium">Split not confirmed.</div>}
                    </td>
                    <td className={`${td} text-right tabular-nums`}>{money(r.total)}</td>
                    <td className={`${td} text-right tabular-nums`}>{money(claimableOf(r))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        {[review, personal].filter((g): g is NonNullable<typeof g> => !!g).map((g) => (
          <section key={g.code} className="mb-6 break-inside-avoid">
            <h3 className="mb-1 font-semibold">
              {g.name} — not included in the total ({money(g.total)})
            </h3>
            <p className="mb-1 text-slate-600">{sectionByCode(g.code).hint}</p>
            <table className="w-full">
              <thead>
                <tr><th className={th}>Date</th><th className={th}>Paid to</th><th className={th}>Reason</th><th className={`${th} text-right`}>Amount</th></tr>
              </thead>
              <tbody>
                {g.items.map((r) => (
                  <tr key={r.id}>
                    <td className={`${td} whitespace-nowrap`}>{r.date}</td>
                    <td className={td}>{r.vendor}</td>
                    <td className={td}>{r.note}</td>
                    <td className={`${td} text-right tabular-nums`}>{money(r.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        <footer className="mt-6 border-t border-slate-300 pt-3 text-xs leading-relaxed text-slate-600">
          Amounts are as recorded from receipts and invoices held by the taxpayer. Splits between work and private use are the
          taxpayer's own, with the reasoning shown against each item. This summary is a record for preparing a return; it is not tax advice.
        </footer>
      </article>
    </div>
  );
}

// §9.4: overnight work travel carries a substantiation expectation, and the trip record
// already holds most of what a diary needs. Blank cells are for filling in by hand.
export function TripDiary({ trip, records, onBack }: { trip: Trip; records: ExpenseRecord[]; onBack: () => void }) {
  const linked = records.filter((r) => r.tripId === trip.id);
  const days: { date: string; kind: string }[] = [];
  for (let d = trip.travelStart; d <= trip.travelEnd && days.length < 366; d = addDays(d, 1)) {
    const kind =
      d >= trip.workStart && d <= trip.workEnd ? trip.type === "exam" ? "Exam" : trip.type === "course" ? "Course" : "Conference"
      : d === trip.travelStart ? "Travel to destination"
      : d === trip.travelEnd ? "Travel home"
      : "Other day away";
    days.push({ date: d, kind });
  }
  const claimable = sum(linked.filter((r) => r.section !== "REVIEW").map(claimableOf));

  return (
    <div>
      <PrintBar onBack={onBack} label="Print or save as PDF" />
      <article className="rounded-2xl border border-slate-300 bg-white p-5 text-sm print:border-0 print:p-0">
        <header className="mb-4">
          <h2 className="text-lg font-semibold">Travel diary — {trip.label}</h2>
          <p className="text-slate-600">
            {trip.destination} · away {longDate(trip.travelStart)} to {longDate(trip.travelEnd)} · event {longDate(trip.workStart)} to {longDate(trip.workEnd)}
            {trip.accompanied ? " · travelled with family" : ""}
          </p>
          {trip.notes && <p className="mt-1">{trip.notes}</p>}
        </header>

        <table className="mb-6 w-full">
          <thead>
            <tr>
              <th className={th}>Date</th><th className={th}>Where</th><th className={th}>Activity</th>
              <th className={th}>Start</th><th className={th}>End</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.date}>
                <td className={`${td} whitespace-nowrap`}>{longDate(d.date)}</td>
                <td className={td}>{trip.destination}</td>
                <td className={td}>
                  {d.kind}
                  {linked.filter((r) => r.date === d.date).map((r) => (
                    <div key={r.id} className="text-slate-600">{r.vendor} · {r.description || kindName.get(r.expenseKind)}</div>
                  ))}
                </td>
                <td className={`${td} w-16`}>&nbsp;</td>
                <td className={`${td} w-16`}>&nbsp;</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="mb-1 font-semibold">Expenses on this trip · {money(claimable)} claimable</h3>
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Date</th><th className={th}>Paid to</th><th className={th}>Kind</th>
              <th className={`${th} text-right`}>Total</th><th className={`${th} text-right`}>Claimed</th><th className={`${th} text-right`}>Private</th>
            </tr>
          </thead>
          <tbody>
            {linked.map((r) => (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap`}>{r.date}</td>
                <td className={td}>
                  {r.vendor}
                  {r.split.basis && <div className="text-slate-600">{r.split.basis}</div>}
                  {needsSolo(trip, r.expenseKind) && r.soloEquivalent ? (
                    <div className="text-slate-600">Solo-equivalent cost {money(r.soloEquivalent)}.</div>
                  ) : null}
                </td>
                <td className={td}>{kindName.get(r.expenseKind)}</td>
                <td className={`${td} text-right tabular-nums`}>{money(r.total)}</td>
                <td className={`${td} text-right tabular-nums`}>{money(claimableOf(r))}</td>
                <td className={`${td} text-right tabular-nums`}>{money(privateOf(r))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <footer className="mt-6 border-t border-slate-300 pt-3 text-xs leading-relaxed text-slate-600">
          Start and end times are left blank to complete by hand. This diary is a record kept for substantiation; it is not tax advice.
        </footer>
      </article>
    </div>
  );
}
