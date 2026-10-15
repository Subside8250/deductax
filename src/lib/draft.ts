import type { ExpenseKind, ExpenseRecord, SectionCode, Split, StoredFile, Trip } from "./types";
import { todayISO } from "./sections";
import { hasTripSplit, isZeroAirfare, needsSolo, proposeTripSplit, tripForDate } from "./tripSplit";

// Form state for the review card. Amounts stay as strings while editing so
// partially typed values ("12.") aren't mangled; they become numbers on filing.
export type DraftForm = {
  vendor: string;
  date: string;
  total: string;
  gst: string;
  description: string;
  section: SectionCode | "";
  expenseKind: ExpenseKind;
  checkIn: string;
  checkOut: string;
  claim: "all" | "part";
  percent: string;
  basis: string;
  note: string;
  soloEquivalent: string;
};

export type Extraction =
  | { status: "reading" }
  | { status: "failed"; message: string }
  | { status: "done"; source: "pdf"; matched: boolean }
  // `detail` says what was read, e.g. "3 sections of a long receipt" or "4 PDF pages".
  | { status: "done"; source: "ai"; matched: true; detail?: string; model?: string };

// A trip-based split proposal as it stands on the card (§4). The user may change the
// claimable amount and the basis; filing requires ticking it as checked.
export type TripSplitState = {
  method: Split["method"];
  proposed: number;
  claim: string;
  basis: string;
  confirmed: boolean;
};

export type Draft = {
  id: string; // becomes the record id
  isNew: boolean;
  // A reminder to add the receipt later; filing it turns it into a normal record.
  status?: "filed" | "awaiting";
  // Set when a captured receipt was matched to an existing reminder, so the card can
  // say so and the user can undo it.
  matched?: { id: string; label: string; why: string } | null;
  capturedAt: string;
  tripId: string | null;
  // "auto" follows the date; "user" means the trip (or no trip) was chosen by hand.
  tripLink?: "auto" | "user" | null;
  tripSplit?: TripSplitState | null;
  imageId: string | null;
  originalImageId: string | null; // the filed record's attachment, when editing
  sourceFile: string;
  confidence: ExpenseRecord["confidence"];
  form: DraftForm;
  extraction?: Extraction;
};

// What an extraction proposes. Fields are form-shaped strings; the work-use
// percentage, when below 100, pre-selects "Claim part" but the basis stays the user's.
export type ExtractionPatch = Partial<
  Pick<DraftForm, "vendor" | "date" | "total" | "gst" | "description" | "section" | "expenseKind" | "checkIn" | "checkOut" | "note">
> & { workUsePercent?: number };

export type ReadResult = {
  patch: ExtractionPatch;
  confidence: ExpenseRecord["confidence"];
  extraction: Extraction;
};

export type FormErrors = Partial<Record<keyof DraftForm | "tripClaim" | "tripBasis" | "tripConfirm", string>>;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const parseAmount = (s: string) => (s.trim() ? Number(s.replace(/[$,\s]/g, "")) : NaN);

const blankForm = (): DraftForm => ({
  vendor: "",
  date: todayISO(),
  total: "",
  gst: "",
  description: "",
  section: "",
  expenseKind: "other",
  checkIn: "",
  checkOut: "",
  claim: "all",
  percent: "",
  basis: "",
  note: "",
  soloEquivalent: "",
});

export function newDraft(file?: StoredFile | null, status: "filed" | "awaiting" = "filed"): Draft {
  return {
    id: crypto.randomUUID(),
    isNew: true,
    status,
    capturedAt: new Date().toISOString(),
    tripId: null,
    tripLink: null,
    tripSplit: null,
    imageId: file?.id ?? null,
    originalImageId: null,
    sourceFile: file?.name ?? "manual",
    // Entered by hand, so there is no extraction uncertainty to report.
    confidence: "high",
    form: blankForm(),
  };
}

// Fills in fields added since a draft was saved, so an older in-progress card still opens.
export const normalizeDraft = (d: Draft): Draft => ({ ...d, form: { ...blankForm(), ...d.form } });

// Fills the card from an extraction. Automatic reads only fill fields the user hasn't
// touched; an explicit "Read with AI" replaces them.
export function applyExtraction(d: Draft, r: ReadResult, overwrite: boolean): Draft {
  const blank = blankForm();
  const form = { ...d.form };
  const { workUsePercent, ...fields } = r.patch;
  for (const [key, value] of Object.entries(fields) as [keyof typeof fields, string][]) {
    if (value !== undefined && (overwrite || form[key] === blank[key])) (form[key] as string) = value;
  }
  if (workUsePercent !== undefined && (overwrite || (form.claim === "all" && !form.percent))) {
    form.claim = "part";
    form.percent = String(workUsePercent);
  }
  return { ...d, form, confidence: r.confidence, extraction: r.extraction };
}

const SPLIT_INPUTS: (keyof DraftForm)[] = ["total", "expenseKind", "date", "checkIn", "checkOut", "soloEquivalent"];

// Keeps the trip link and trip split in step with the card. Called with the card before
// and after a change: follows the date to a trip unless the user picked one, and
// re-proposes the split when anything the engine reads has changed.
export function syncTrip(prev: Draft | null, next: Draft, trips: Trip[]): Draft {
  const f = next.form;
  const p = prev?.form;
  let d = next;

  if (d.tripLink !== "user" && (!p || p.date !== f.date || prev?.tripLink === "user")) {
    const trip = tripForDate(trips, f.date);
    d = { ...d, tripId: trip?.id ?? null, tripLink: trip ? "auto" : null };
  }
  if (d.tripId && !trips.some((t) => t.id === d.tripId)) d = { ...d, tripId: null, tripLink: null };

  const changed = !prev || prev.tripId !== d.tripId || SPLIT_INPUTS.some((k) => p![k] !== f[k]);
  if (!changed) return d;

  const trip = trips.find((t) => t.id === d.tripId) ?? null;
  const proposal = trip
    ? proposeTripSplit(
        {
          total: parseAmount(f.total),
          expenseKind: f.expenseKind,
          date: f.date,
          checkIn: f.checkIn || null,
          checkOut: f.checkOut || null,
          soloEquivalent: parseAmount(f.soloEquivalent) || null,
        },
        trip
      )
    : null;
  if (!proposal) return { ...d, tripSplit: null };

  let form = d.form;
  // §4.2: a flight whose private purpose dominates goes to review.
  if (isZeroAirfare(f.expenseKind, proposal) && (form.section === "D2" || form.section === "D4")) {
    form = { ...form, section: "REVIEW" };
  }
  return {
    ...d,
    form,
    tripSplit: {
      method: proposal.method,
      proposed: proposal.claimable,
      claim: proposal.claimable.toFixed(2),
      basis: proposal.basis,
      confirmed: false,
    },
  };
}

// Points a freshly captured receipt at the reminder it belongs to: the record keeps its
// id, so filing completes the note instead of leaving a duplicate behind. Anything the
// receipt didn't say is taken from the note.
export function adoptReminder(d: Draft, reminder: ExpenseRecord, why: string): Draft {
  const blank = blankForm();
  const form = { ...d.form };
  if (form.vendor === blank.vendor) form.vendor = reminder.vendor;
  if (form.description === blank.description) form.description = reminder.description;
  if (!parseAmount(form.total) && reminder.total > 0) form.total = String(reminder.total);
  if (form.section === blank.section && reminder.section !== "REVIEW") form.section = reminder.section;
  if (form.note === blank.note) form.note = reminder.note;
  return {
    ...d,
    id: reminder.id,
    isNew: false,
    status: "awaiting",
    capturedAt: reminder.capturedAt,
    tripId: d.tripId ?? reminder.tripId,
    form,
    matched: { id: reminder.id, label: `${reminder.vendor || reminder.description}${reminder.total > 0 ? ` · ${reminder.total.toFixed(2)}` : ""}`, why },
  };
}

// Undoes a match: the capture becomes its own new record and the reminder is left alone.
export const releaseReminder = (d: Draft): Draft => ({
  ...d,
  id: crypto.randomUUID(),
  isNew: true,
  status: "filed",
  capturedAt: new Date().toISOString(),
  matched: null,
});

export function draftFromRecord(r: ExpenseRecord): Draft {
  const tripSplit = hasTripSplit(r);
  const part = !tripSplit && r.split.method === "percent";
  return {
    id: r.id,
    isNew: false,
    status: r.status ?? "filed",
    capturedAt: r.capturedAt,
    tripId: r.tripId,
    tripLink: "auto",
    tripSplit: tripSplit
      ? {
          method: r.split.method,
          proposed: r.split.claimable,
          claim: r.split.claimable.toFixed(2),
          basis: r.split.basis,
          confirmed: r.split.confirmed,
        }
      : null,
    imageId: r.imageId,
    originalImageId: r.imageId,
    sourceFile: r.sourceFile,
    confidence: r.confidence,
    form: {
      vendor: r.vendor,
      date: r.date,
      total: String(r.total),
      gst: r.gst ? String(r.gst) : "",
      description: r.description,
      section: r.section,
      expenseKind: r.expenseKind,
      checkIn: r.checkIn ?? "",
      checkOut: r.checkOut ?? "",
      claim: part ? "part" : "all",
      percent: part && r.total ? String(round2((r.split.claimable / r.total) * 100)) : "",
      basis: part ? r.split.basis : "",
      note: r.note,
      soloEquivalent: r.soloEquivalent ? String(r.soloEquivalent) : "",
    },
  };
}

// The trip split applies unless the expense is marked not deductible.
export const activeTripSplit = (d: Draft) => (d.tripSplit && d.form.section !== "PERSONAL" ? d.tripSplit : null);

export const canClaimPart = (d: Draft) => !activeTripSplit(d) && d.form.section !== "" && d.form.section !== "PERSONAL";

// A reminder only has to say what it is; everything else waits for the receipt.
export function validateReminder(f: DraftForm): FormErrors {
  return f.vendor.trim() || f.description.trim() ? {} : { vendor: "Enter who you paid, or what it was for." };
}

export function validate(d: Draft, trips: Trip[]): FormErrors {
  const f = d.form;
  const e: FormErrors = {};
  if (!f.vendor.trim()) e.vendor = "Enter who you paid.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) e.date = "Enter the date.";
  const total = parseAmount(f.total);
  if (!(total > 0)) e.total = "Enter the amount paid.";
  if (f.gst.trim()) {
    const gst = parseAmount(f.gst);
    if (!(gst >= 0)) e.gst = "Enter a number, or leave blank.";
    else if (total > 0 && gst > total) e.gst = "GST can't be more than the total.";
  }
  if (!f.section) e.section = "Choose where this goes on your return.";
  if (!f.note.trim()) {
    e.note =
      f.section === "PERSONAL" ? "Say why this isn't deductible."
      : f.section === "REVIEW" ? "Say what's unclear."
      : "Say why it goes under this label.";
  }
  if (f.expenseKind === "accommodation" && f.checkIn && f.checkOut && f.checkOut < f.checkIn) {
    e.checkOut = "Check out is before check in.";
  }
  if (f.claim === "part" && canClaimPart(d)) {
    const pct = parseAmount(f.percent);
    if (!(pct > 0 && pct < 100)) e.percent = "Enter a percentage between 0 and 100.";
    if (!f.basis.trim()) e.basis = "Say how you arrived at the percentage.";
  }

  const trip = trips.find((t) => t.id === d.tripId) ?? null;
  if (f.section !== "PERSONAL" && needsSolo(trip, f.expenseKind)) {
    const solo = parseAmount(f.soloEquivalent);
    if (!(solo > 0)) e.soloEquivalent = "Enter what this would have cost travelling alone.";
    else if (total > 0 && solo > total) e.soloEquivalent = "That's more than you paid. Enter the total if it would have cost the same.";
  }
  const ts = activeTripSplit(d);
  if (ts) {
    const claim = parseAmount(ts.claim);
    if (!(claim >= 0) || (total > 0 && claim > total)) e.tripClaim = "Enter an amount between $0 and the total.";
    if (!ts.basis.trim()) e.tripBasis = "Say how the split was decided.";
    if (!ts.confirmed) e.tripConfirm = "Tick to confirm you've checked this split.";
  }
  return e;
}

export function buildSplit(d: Draft): Split {
  const f = d.form;
  const total = round2(parseAmount(f.total)) || 0;
  const ts = activeTripSplit(d);
  if (ts) {
    const claimable = round2(parseAmount(ts.claim) || 0);
    return {
      // An amount changed by hand is the user's own decision, not the engine's.
      method: Math.abs(claimable - ts.proposed) < 0.005 ? ts.method : "manual",
      claimable,
      private: round2(total - claimable),
      basis: ts.basis.trim(),
      confirmed: ts.confirmed,
    };
  }
  if (f.claim === "part" && canClaimPart(d)) {
    const claimable = round2((total * (parseAmount(f.percent) || 0)) / 100);
    // User-entered, so confirmed at the moment of filing.
    return { method: "percent", claimable, private: round2(total - claimable), basis: f.basis.trim(), confirmed: true };
  }
  return { method: "full", claimable: total, private: 0, basis: "", confirmed: true };
}

export function toRecord(d: Draft): ExpenseRecord {
  const f = d.form;
  const accommodation = f.expenseKind === "accommodation";
  const solo = parseAmount(f.soloEquivalent);
  return {
    id: d.id,
    status: d.status ?? "filed",
    capturedAt: d.capturedAt,
    updatedAt: new Date().toISOString(),
    vendor: f.vendor.trim(),
    date: f.date,
    // A reminder may have no amount yet.
    total: round2(parseAmount(f.total)) || 0,
    gst: f.gst.trim() ? round2(parseAmount(f.gst)) : 0,
    description: f.description.trim(),
    // A reminder has no label yet; REVIEW stands in until it is filed.
    section: (f.section || "REVIEW") as SectionCode,
    tripId: d.tripId,
    expenseKind: f.expenseKind,
    checkIn: accommodation && f.checkIn ? f.checkIn : null,
    checkOut: accommodation && f.checkOut ? f.checkOut : null,
    soloEquivalent: solo > 0 ? round2(solo) : null,
    split: buildSplit(d),
    confidence: d.confidence,
    note: f.note.trim(),
    sourceFile: d.sourceFile,
    imageId: d.imageId,
  };
}
