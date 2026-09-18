import { SECTIONS } from "./sections";
import type { ExpenseRecord, SectionCode } from "./types";

// Australian financial year, 1 July to 30 June, labelled by its start year: 2025 = "2025–26".
export const fyOf = (date: string) => {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 7 ? y : y - 1;
};
export const fyLabel = (start: number) => `${start}–${String((start + 1) % 100).padStart(2, "0")}`;
export const fyRange = (start: number) => ({ from: `${start}-07-01`, to: `${start + 1}-06-30` });

export const isDeductible = (code: SectionCode) => code !== "REVIEW" && code !== "PERSONAL";

// A PERSONAL record carries a full split by the data model's definition, but nothing
// of it is claimed. Displays and exports go through these so that reads as $0.
export const claimableOf = (r: ExpenseRecord) => (r.section === "PERSONAL" ? 0 : r.split.claimable);
export const privateOf = (r: ExpenseRecord) => (r.section === "PERSONAL" ? r.total : r.split.private);

const cents = (n: number) => Math.round(n * 100);
export const sum = (values: number[]) => values.reduce((s, v) => s + cents(v), 0) / 100;

export type SectionGroup = (typeof SECTIONS)[number] & {
  items: ExpenseRecord[];
  claimable: number;
  total: number;
};

// Records for one financial year, grouped in the order the labels appear on the return,
// newest first within each label. Empty labels are left out.
export function groupBySection(records: ExpenseRecord[], fy: number): SectionGroup[] {
  const inYear = records.filter((r) => fyOf(r.date) === fy);
  return SECTIONS.map((s) => {
    const items = inYear
      .filter((r) => r.section === s.code)
      .sort((a, b) => b.date.localeCompare(a.date) || b.capturedAt.localeCompare(a.capturedAt));
    return { ...s, items, claimable: sum(items.map(claimableOf)), total: sum(items.map((r) => r.total)) };
  }).filter((g) => g.items.length > 0);
}

export const deductionTotal = (groups: SectionGroup[]) =>
  sum(groups.filter((g) => isDeductible(g.code)).map((g) => g.claimable));

// Years that have records, plus the current one, newest first.
export function availableYears(records: ExpenseRecord[], today: string) {
  return [...new Set([fyOf(today), ...records.map((r) => fyOf(r.date))])].sort((a, b) => b - a);
}
