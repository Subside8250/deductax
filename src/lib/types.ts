// Data model — SPEC.md §3.

export type SectionCode =
  | "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "D7" | "D8" | "D9" | "D10"
  | "REVIEW" | "PERSONAL";

export type ExpenseKind =
  | "airfare" | "accommodation" | "meal" | "ground_transport"
  | "registration" | "subscription" | "equipment" | "insurance"
  | "utility" | "other";

export type Split = {
  method: "full" | "percent" | "nights" | "manual";
  claimable: number; // AUD
  private: number; // AUD; claimable + private === total
  basis: string; // human-readable justification, goes in exports
  confirmed: boolean; // true once the user has accepted the proposal
};

// Named ExpenseRecord rather than Record to avoid shadowing TypeScript's Record<K, V>.
export type ExpenseRecord = {
  id: string;
  // "awaiting" is a note to add the receipt later: it is kept out of totals and exports
  // until it is filed. Absent on records saved before reminders existed.
  status?: "filed" | "awaiting";
  capturedAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp; per-record merge key for sync (§8)
  vendor: string;
  date: string; // YYYY-MM-DD, transaction date
  total: number; // AUD, as paid
  gst: number;
  description: string;
  section: SectionCode;
  tripId: string | null;
  expenseKind: ExpenseKind;
  checkIn: string | null; // accommodation only; read by the apportionment engine
  checkOut: string | null;
  // What the expense would have cost travelling alone, when family came along (§4.3).
  // Absent on records filed before trips existed.
  soloEquivalent?: number | null;
  split: Split;
  confidence: "high" | "medium" | "low";
  note: string; // why this label; for PERSONAL, why it fails
  sourceFile: string;
  imageId: string | null; // IndexedDB key for the stored image/PDF
};

export type Trip = {
  id: string;
  label: string;
  type: "conference" | "exam" | "course";
  destination: string;
  workStart: string;
  workEnd: string;
  travelStart: string;
  travelEnd: string;
  accompanied: boolean;
  notes: string;
  updatedAt?: string; // per-trip merge key for sync (§8)
};

export type StoredFile = {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  size: number;
  addedAt: string;
};
