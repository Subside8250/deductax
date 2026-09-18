import type { ExpenseKind, ExpenseRecord, SectionCode } from "./types";
import type { ExtractionPatch } from "./draft";
import { EXPENSE_KINDS, SECTIONS } from "./sections";

// Local, rule-based reading of text-layer PDF invoices (SPEC §6). No AI, no upload.
// Amounts, dates and the vendor are read from the text. Labels come from the user's own
// issuer rules, kept on the device, plus the two general rules below.

export type InvoiceRule = {
  match: RegExp;
  section: SectionCode;
  expenseKind: ExpenseKind;
  description: string;
  note: string;
};

const SECTION_CODES = new Set(SECTIONS.map((s) => s.code));
const KINDS = new Set<string>(EXPENSE_KINDS.map(([k]) => k));

// One rule per line:
//   Issuer name, another name => D5 | registration | Short description | why it goes there
// Keywords are comma-separated; the description and reason are optional.
export function parseRules(text: string): InvoiceRule[] {
  const rules: InvoiceRule[] = [];
  for (const line of text.split("\n")) {
    const [left, right] = line.split("=>");
    if (!right) continue;
    const keywords = left.split(",").map((k) => k.trim()).filter(Boolean);
    const [section, kind, description, note] = right.split("|").map((p) => p.trim());
    if (!keywords.length || !SECTION_CODES.has(section as SectionCode)) continue;
    const escaped = keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    rules.push({
      match: new RegExp(`\\b(?:${escaped.join("|")})\\b`, "i"),
      section: section as SectionCode,
      expenseKind: (KINDS.has(kind) ? kind : "other") as ExpenseKind,
      description: description || "",
      note: note || `Matched your rule for ${keywords[0]}.`,
    });
  }
  return rules;
}

const EDUCATION = /\b(conference|congress|symposium|scientific meeting|ASM|workshop|course|exam|examination)\b/i;

const EDUCATION_RULE = {
  section: "D4" as SectionCode,
  expenseKind: "registration" as ExpenseKind,
  description: "Conference, course or exam fee",
  note: "Conference, course and exam fees are self-education expenses tied to your current role, claimed at D4.",
};

// General rules that hold for any employee, so they live in the code.
const BUILT_IN: InvoiceRule[] = [
  {
    match: /\btax agent\b|preparation of (your |the )?(\d{4} )?(income )?tax return|tax return preparation/i,
    section: "D10",
    expenseKind: "other",
    description: "Tax agent fee",
    note: "Fees paid to a registered tax agent for managing your tax affairs are claimed at D10.",
  },
  {
    match: /\b(conference|congress|symposium|workshop|course)\b[^\n]*\bregistration\b|\bregistration\b[^\n]*\b(conference|congress|symposium|workshop|course)\b/i,
    ...EDUCATION_RULE,
  },
];

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");

function isoDate(y: number, m: number, d: number) {
  if (y < 100) y += 2000;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function findDateIn(line: string): string | null {
  let m = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return isoDate(+m[1], +m[2], +m[3]);
  // Australian order: day first.
  m = line.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/);
  if (m) return isoDate(+m[3], +m[2], +m[1]);
  m = line.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})\b/i);
  if (m) return isoDate(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = line.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i);
  if (m) return isoDate(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  return null;
}

export function amountsIn(line: string) {
  return [...line.matchAll(/(?<![\d.])\$?\s?(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})(?!\d)/g)].map((m) =>
    Number(`${m[1].replace(/,/g, "")}.${m[2]}`)
  );
}

// Amounts on a labelled line, or on the next line when the label stands alone.
const amountsNear = (lines: string[], i: number) => {
  const own = amountsIn(lines[i]);
  return own.length ? own : amountsIn(lines[i + 1] ?? "");
};

function findDate(lines: string[]) {
  const label = /(invoice|issue|issued|payment|paid|transaction|receipt)\s*date|date\s*(of\s*)?(issue|invoice|payment)|date\s*paid/i;
  for (let i = 0; i < lines.length; i++) {
    if (!label.test(lines[i])) continue;
    const d = findDateIn(lines[i]) ?? findDateIn(lines[i + 1] ?? "");
    if (d) return d;
  }
  for (const l of lines) {
    const d = findDateIn(l);
    if (d) return d;
  }
  return null;
}

function findTotal(lines: string[]) {
  const label = /\b(total|amount\s+(due|paid|payable)|balance\s+due|you\s+paid)\b/i;
  const skip = /\bsub[\s-]?total\b|total\s+gst|gst\s+total/i;
  const found: number[] = [];
  lines.forEach((l, i) => {
    if (label.test(l) && !skip.test(l)) found.push(...amountsNear(lines, i));
  });
  return found.length ? Math.max(...found) : null;
}

function findGst(lines: string[], total: number | null) {
  const found: number[] = [];
  lines.forEach((l, i) => {
    if (/\bGST\b/i.test(l)) found.push(...amountsNear(lines, i).filter((a) => a !== total));
  });
  if (!found.length) return null;
  if (total === null) return found.length === 1 ? found[0] : null;
  const expected = total / 11;
  const best = found.reduce((a, b) => (Math.abs(b - expected) < Math.abs(a - expected) ? b : a));
  return Math.abs(best - expected) <= expected * 0.3 ? best : null;
}

function fallbackVendor(lines: string[]) {
  const generic = /^(tax\s+)?(invoice|receipt)\b|^page\s+\d|^abn\b|^date\b/i;
  const line = lines.find((l) => /[A-Za-z]{3}/.test(l) && !generic.test(l.trim()));
  return line ? line.trim().slice(0, 60) : null;
}

export type LocalRead = { patch: ExtractionPatch; confidence: ExpenseRecord["confidence"]; matched: boolean };

export function parseInvoiceText(lines: string[], userRules: InvoiceRule[] = []): LocalRead {
  const text = lines.join("\n");
  const rule = [...userRules, ...BUILT_IN].find((r) => r.match.test(text));
  const total =
    findTotal(lines) ??
    (() => {
      const all = lines.flatMap(amountsIn);
      return all.length ? Math.max(...all) : null;
    })();
  const gst = findGst(lines, total);
  const date = findDate(lines);

  const patch: ExtractionPatch = {};
  if (date) patch.date = date;
  if (total !== null) patch.total = total.toFixed(2);
  if (gst !== null) patch.gst = gst.toFixed(2);

  const vendor = rule?.match.exec(text)?.[0] ?? fallbackVendor(lines);
  if (vendor) patch.vendor = vendor;

  if (rule) {
    // An otherwise ordinary issuer billing for a conference, course or exam is self-education.
    const labelled = rule.section === "D5" && EDUCATION.test(text) && /\bregistration|fee\b/i.test(text)
      ? { ...rule, ...EDUCATION_RULE }
      : rule;
    patch.section = labelled.section;
    patch.expenseKind = labelled.expenseKind;
    if (labelled.description) patch.description = labelled.description;
    patch.note = labelled.note;
  }

  const complete = !!(rule && date && total !== null);
  return { patch, confidence: complete ? "high" : rule ? "medium" : "low", matched: !!rule };
}
