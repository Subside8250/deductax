import { CircleAlert, Download, Paperclip, Printer } from "lucide-react";
import { money } from "../lib/sections";
import { claimableOf, deductionTotal, fyLabel, fyRange, isDeductible, type SectionGroup } from "../lib/totals";
import type { ExpenseRecord, Trip } from "../lib/types";

type Props = {
  groups: SectionGroup[];
  trips: Trip[];
  years: number[];
  fy: number;
  onYear: (fy: number) => void;
  onOpen: (r: ExpenseRecord) => void;
  onExport: () => void;
  onReport: () => void;
};

// The primary view (SPEC §9.1): claimable amounts by myTax label, in return order.
export default function SectionList({ groups, trips, years, fy, onYear, onOpen, onExport, onReport }: Props) {
  const total = deductionTotal(groups);
  const review = groups.find((g) => g.code === "REVIEW");
  const unconfirmed = groups.flatMap((g) => g.items).filter((r) => !r.split.confirmed).length;
  const { from, to } = fyRange(fy);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-slate-300 pb-3">
        <div>
          <label className="mb-1 flex items-center gap-2 text-sm text-slate-600">
            Deductions for
            <select value={fy} onChange={(e) => onYear(Number(e.target.value))}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-900">
              {years.map((y) => <option key={y} value={y}>FY {fyLabel(y)}</option>)}
            </select>
          </label>
          <div className="text-3xl font-semibold tracking-tight">{money(total)}</div>
          <div className="text-xs text-slate-500">{from} to {to}</div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onReport} disabled={!groups.length}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:border-slate-400 disabled:opacity-50">
            <Printer size={15} /> Summary
          </button>
          <button type="button" onClick={onExport} disabled={!groups.length}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:border-slate-400 disabled:opacity-50">
            <Download size={15} /> CSV
          </button>
        </div>
      </div>

      {review && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          {review.items.length === 1
            ? "1 item still needs a decision before you lodge. It isn't in the total."
            : `${review.items.length} items still need a decision before you lodge. They aren't in the total.`}
        </div>
      )}

      {unconfirmed > 0 && (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <CircleAlert size={16} className="mt-0.5 shrink-0" />
          {unconfirmed === 1
            ? "1 split is waiting for you to check. It's counted at the suggested amount."
            : `${unconfirmed} splits are waiting for you to check. They're counted at the suggested amounts.`}
        </div>
      )}

      {!groups.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center text-sm text-slate-500">
          Nothing filed for FY {fyLabel(fy)} yet.
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => {
            const deductible = isDeductible(g.code);
            return (
              <section key={g.code}>
                <div className="mb-2 flex items-baseline justify-between gap-3">
                  <h3 className={`font-semibold ${deductible ? "" : "text-slate-500"}`}>
                    {deductible ? `${g.code} — ${g.name}` : g.name}
                  </h3>
                  <span className={`shrink-0 text-right font-semibold ${deductible ? "" : "text-slate-500"}`}>
                    {g.code === "PERSONAL" ? (
                      <span className="text-sm font-normal">{money(g.total)} not claimed</span>
                    ) : g.code === "REVIEW" ? (
                      <span className="text-sm font-normal">{money(g.total)} undecided</span>
                    ) : (
                      money(g.claimable)
                    )}
                  </span>
                </div>
                <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {g.items.map((r) => {
                    const trip = r.tripId ? trips.find((t) => t.id === r.tripId) : null;
                    const partial = deductible && r.split.method !== "full";
                    return (
                      <li key={r.id}>
                        <button type="button" onClick={() => onOpen(r)}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-stone-50 focus:outline-none focus-visible:bg-stone-100">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium">{r.vendor}</span>
                              {r.imageId && <Paperclip size={13} className="shrink-0 text-slate-400" aria-label="Receipt attached" />}
                            </div>
                            <div className="truncate text-sm text-slate-500">
                              {r.date}
                              {r.description ? ` · ${r.description}` : ""}
                              {trip ? ` · ${trip.label}` : ""}
                            </div>
                            {!r.split.confirmed && (
                              <div className="mt-1 text-xs font-medium text-amber-800">Split not confirmed</div>
                            )}
                            {partial && r.split.basis && (
                              <p className="mt-1.5 border-l-2 border-emerald-300 pl-2.5 text-sm leading-snug text-slate-600">
                                {r.split.basis}
                                {r.split.private > 0 ? ` ${money(r.split.private)} treated as private.` : ""}
                              </p>
                            )}
                            {!deductible && r.note && (
                              <p className="mt-1.5 border-l-2 border-slate-300 pl-2.5 text-sm leading-snug text-slate-600">{r.note}</p>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <div className={`font-medium ${deductible ? "" : "text-slate-500"}`}>
                              {money(deductible ? claimableOf(r) : r.total)}
                            </div>
                            {partial && <div className="text-xs text-slate-500">of {money(r.total)}</div>}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
