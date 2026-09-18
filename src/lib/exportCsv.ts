import { EXPENSE_KINDS } from "./sections";
import { claimableOf, fyLabel, groupBySection, privateOf } from "./totals";
import type { ExpenseRecord, Trip } from "./types";

// SPEC §9.2 column order. Non-deductible and review items are always included.
const HEADER = ["Section", "Label", "Date", "Vendor", "Description", "Expense kind", "Total", "Claimable", "Private", "Split basis", "GST", "Trip", "Reason"];

const kindName = new Map(EXPENSE_KINDS);

// Quotes every cell. Text that a spreadsheet would treat as a formula is prefixed
// with an apostrophe, since vendor names and reasons can come from a scanned document.
function cell(v: string | number) {
  let s = typeof v === "number" ? v.toFixed(2) : v;
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function buildCsv(records: ExpenseRecord[], trips: Trip[], fy: number) {
  const tripName = new Map(trips.map((t) => [t.id, t.label]));
  const rows: (string | number)[][] = [HEADER];
  for (const g of groupBySection(records, fy)) {
    for (const r of g.items) {
      rows.push([
        g.code,
        g.name,
        r.date,
        r.vendor,
        r.description,
        kindName.get(r.expenseKind) ?? r.expenseKind,
        r.total,
        claimableOf(r),
        privateOf(r),
        r.split.confirmed ? r.split.basis : `UNCONFIRMED${r.split.basis ? `: ${r.split.basis}` : ""}`,
        r.gst,
        r.tripId ? tripName.get(r.tripId) ?? "" : "",
        r.note,
      ]);
    }
  }
  // BOM so Excel opens it as UTF-8 (en dashes, accented vendor names).
  return "﻿" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const csvFileName = (fy: number) => `deductions-FY${fyLabel(fy).replace("–", "-")}.csv`;

export function downloadCsv(csv: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
