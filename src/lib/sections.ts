import type { ExpenseKind, SectionCode } from "./types";

// ---------------------------------------------------------------------------
// myTax deduction labels (individual, non-business return)
// ---------------------------------------------------------------------------
export const SECTIONS: { code: SectionCode; name: string; hint: string }[] = [
  { code: "D1", name: "Work-related car expenses", hint: "Work travel in your own car. Not home-to-work commuting." },
  { code: "D2", name: "Work-related travel expenses", hint: "Flights, accommodation, meals while travelling for work." },
  { code: "D3", name: "Work-related clothing & laundry", hint: "Compulsory or logo uniform, protective wear, laundering." },
  { code: "D4", name: "Work-related self-education", hint: "Courses, conferences, CPD tied to your current role." },
  { code: "D5", name: "Other work-related expenses", hint: "Registration, memberships, insurance, journals, equipment, phone." },
  { code: "D6", name: "Low-value pool deduction", hint: "Depreciating assets under the low-value pool rules." },
  { code: "D7", name: "Interest deductions", hint: "Interest on money borrowed to earn interest income." },
  { code: "D8", name: "Dividend deductions", hint: "Costs of earning dividend or share income." },
  { code: "D9", name: "Gifts or donations", hint: "Donations of $2+ to deductible gift recipients." },
  { code: "D10", name: "Cost of managing tax affairs", hint: "Tax agent fees, tax software, ATO interest charges." },
  { code: "REVIEW", name: "Needs your review", hint: "Couldn't be confidently placed. Decide before lodging." },
  { code: "PERSONAL", name: "Not deductible", hint: "Private expense. Kept for your records only." },
];

export const EXPENSE_KINDS: [ExpenseKind, string][] = [
  ["airfare", "Flight"],
  ["accommodation", "Accommodation"],
  ["meal", "Meal"],
  ["ground_transport", "Taxi / parking / transport"],
  ["registration", "Registration or course fee"],
  ["subscription", "Subscription or membership"],
  ["equipment", "Equipment"],
  ["insurance", "Insurance"],
  ["utility", "Phone / internet"],
  ["other", "Other"],
];

export const sectionByCode = (code: string) => SECTIONS.find((s) => s.code === code) || SECTIONS[10];

export const sectionLabel = (code: SectionCode) => {
  const s = sectionByCode(code);
  return s.code === "REVIEW" || s.code === "PERSONAL" ? s.name : `${s.code} — ${s.name}`;
};

export const money = (n: number | string) =>
  "$" + (Number(n) || 0).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Local calendar date. toISOString() gives the UTC date, which east of Greenwich
// returns yesterday for part of the morning.
export const todayISO = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const daysBetween = (a: string, b: string) =>
  Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1);

export const within = (d: string, start: string, end: string) => d >= start && d <= end;
