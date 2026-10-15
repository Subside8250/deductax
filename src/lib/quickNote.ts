import { todayISO } from "./sections";
import type { ExpenseRecord } from "./types";

// One line in, one reminder out: "Hotel Grand 340" or "$85 dinner with the exam group".
// Anything it can't read stays in the name, so nothing typed is lost.

const AMOUNT = /(?:^|\s)\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?=\s|$)/g;

export type QuickNote = { vendor: string; total: number | null; date: string };

export function parseQuickNote(input: string, today = todayISO()): QuickNote {
  let text = input.trim();
  let date = today;

  // A date written in the line, e.g. "12/10" or "12/10/26", otherwise today.
  const dateMatch = text.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s|$)/);
  if (dateMatch) {
    const [, d, m, y] = dateMatch;
    const year = y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : Number(today.slice(0, 4));
    const iso = `${year}-${String(Number(m)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
    if (Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      // A date later than today is almost certainly last year's.
      date = iso > today && !y ? `${year - 1}${iso.slice(4)}` : iso;
      text = text.replace(dateMatch[0], " ");
    }
  } else if (/(^|\s)yesterday(\s|$)/i.test(text)) {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    date = d.toISOString().slice(0, 10);
    text = text.replace(/(^|\s)yesterday(\s|$)/i, " ");
  } else if (/(^|\s)today(\s|$)/i.test(text)) {
    text = text.replace(/(^|\s)today(\s|$)/i, " ");
  }

  // The last money-looking number is the amount; a dollar sign makes it certain.
  const matches = [...text.matchAll(AMOUNT)];
  const chosen = matches.filter((m) => m[0].includes("$")).pop() ?? matches.pop();
  let total: number | null = null;
  if (chosen) {
    total = Number(chosen[1].replace(/,/g, ""));
    text = `${text.slice(0, chosen.index)} ${text.slice(chosen.index! + chosen[0].length)}`;
  }

  return { vendor: text.replace(/\s{2,}/g, " ").trim(), total: total && total > 0 ? total : null, date };
}

// ---------------------------------------------------------------------------
// Matching a captured receipt back to a reminder
// ---------------------------------------------------------------------------

const words = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w));
const STOP = new Set(["with", "from", "that", "this", "receipt", "invoice", "paid", "about", "dinner's"]);

const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

export type ReminderMatch = { record: ExpenseRecord; score: number; why: string };

// Scores a reminder against what was read off a receipt. The amount is the strongest
// signal, a shared word in the name next, and a nearby date supports either.
export function scoreReminder(reminder: ExpenseRecord, read: { vendor: string; total: number | null; date: string }): ReminderMatch | null {
  const reasons: string[] = [];
  let score = 0;

  if (reminder.total > 0 && read.total && Math.abs(reminder.total - read.total) <= Math.max(0.02, read.total * 0.01)) {
    score += 3;
    reasons.push("same amount");
  }
  const shared = words(`${reminder.vendor} ${reminder.description}`).filter((w) => words(read.vendor).includes(w));
  if (shared.length) {
    score += 2;
    reasons.push(`"${shared[0]}" in the name`);
  }
  const apart = daysApart(reminder.date, read.date);
  if (apart <= 7) {
    score += 1;
    reasons.push(apart < 1 ? "same date" : "within a week");
  } else if (apart > 60) {
    score -= 1;
  }

  return score >= 3 ? { record: reminder, score, why: reasons.join(", ") } : null;
}

export function bestReminderMatch(reminders: ExpenseRecord[], read: { vendor: string; total: number | null; date: string }) {
  return reminders
    .map((r) => scoreReminder(r, read))
    .filter((m): m is ReminderMatch => !!m)
    .sort((a, b) => b.score - a.score || daysApart(a.record.date, read.date) - daysApart(b.record.date, read.date))[0] ?? null;
}
