import { sectionLabel } from "./sections";
import type { Profile } from "./profile";
import type { ExpenseRecord, StoredFile, Trip } from "./types";

// Sync document and record-level three-way merge (SPEC §8). Pure: no I/O.

export type Tombstone = { id: string; kind: "record" | "trip"; deletedAt: string };
export type FileMeta = { id: string; name: string; type: string; size: number; orphanedAt?: string };

export type SyncDoc = {
  app: "deductax";
  version: 1;
  savedAt: string;
  records: ExpenseRecord[];
  trips: Trip[];
  tombstones: Tombstone[];
  files: FileMeta[];
  // The taxpayer's own details, carried between their devices. API keys are never here.
  profile?: Profile;
};

export type LocalState = {
  records: ExpenseRecord[];
  trips: Trip[];
  tombstones: Tombstone[];
  files: Pick<StoredFile, "id" | "name" | "type" | "size">[];
  profile?: Profile;
};

export const emptyDoc = (): SyncDoc => ({ app: "deductax", version: 1, savedAt: "", records: [], trips: [], tombstones: [], files: [] });

export function parseDoc(text: string): SyncDoc {
  let d: Partial<SyncDoc>;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error("The sync file in Dropbox is damaged, so nothing was changed.");
  }
  if (d?.app !== "deductax" || d.version !== 1 || !Array.isArray(d.records) || !Array.isArray(d.trips)) {
    throw new Error("The sync file in Dropbox isn't one this version of the app can read, so nothing was changed.");
  }
  return { ...emptyDoc(), ...d } as SyncDoc;
}

// Unreferenced receipts are kept this long before removal, in case a device that
// hasn't synced yet restores the record that used them.
export const ORPHAN_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

type Stamped = { id: string; updatedAt?: string };
const stamp = (x: Stamped | undefined) => x?.updatedAt ?? "";

// The id a conflict copy of a version gets. Deterministic, so the other device can tell
// that its own edit has already been kept and the conflict isn't raised twice.
export const conflictId = (id: string, version: string) => `${id}.conflict.${version.replace(/\D/g, "")}`;

type MergeResult<T> = { items: T[]; conflicts: [T, T][] };

// Merges one collection by id against the state at the last sync:
// - changed on one side only: that side wins;
// - changed on both: a conflict, for the caller to resolve;
// - removed on one side, untouched on the other: the removal wins;
// - removed on one side, edited on the other: the edit wins.
export function mergeById<T extends Stamped>(
  base: T[] | null,
  local: T[],
  remote: T[],
  tombstones: Map<string, Tombstone>
): MergeResult<T> {
  const B = new Map((base ?? []).map((x) => [x.id, x]));
  const L = new Map(local.map((x) => [x.id, x]));
  const R = new Map(remote.map((x) => [x.id, x]));
  const items: T[] = [];
  const conflicts: [T, T][] = [];

  for (const id of new Set([...L.keys(), ...R.keys()])) {
    const b = B.get(id);
    const l = L.get(id);
    const r = R.get(id);

    if (l && r) {
      if (stamp(l) === stamp(r)) items.push(l);
      else if (b && stamp(l) === stamp(b)) items.push(r);
      else if (b && stamp(r) === stamp(b)) items.push(l);
      else if (!b) items.push(stamp(l) >= stamp(r) ? l : r); // no shared history: newer edit
      else if (R.has(conflictId(id, stamp(l)))) items.push(r); // our edit was already kept as a copy
      else if (L.has(conflictId(id, stamp(r)))) items.push(l); // theirs was already kept as a copy
      else conflicts.push([l, r]);
      continue;
    }

    const only = (l ?? r)!;
    if (b) {
      // It was synced before, so the other side removed it. An untouched copy follows the removal.
      if (stamp(only) === stamp(b)) continue;
    } else {
      // Never synced from here; respect a recorded deletion made after this version.
      const t = tombstones.get(id);
      if (t && t.deletedAt >= stamp(only)) continue;
    }
    items.push(only);
  }
  return { items, conflicts };
}

const editedAt = (iso: string | undefined) =>
  iso
    ? new Date(iso).toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "an unknown time";

// Both versions end up on every device, so the note describes the version, not the device.
function flagConflict(r: ExpenseRecord, id: string, now: string): ExpenseRecord {
  const was = r.section === "REVIEW" ? "" : ` It was filed under ${sectionLabel(r.section)}.`;
  return {
    ...r,
    id,
    section: "REVIEW",
    note: `Sync conflict: this record was changed on two devices before they synced, so both versions were kept. This version was edited ${editedAt(r.updatedAt)}.${was} Keep the right one and delete the other.\n${r.note}`.trim(),
    updatedAt: now,
  };
}

export type MergeOutput = { doc: SyncDoc; conflicts: number; expiredFiles: string[] };

export function mergeDocs(base: SyncDoc | null, local: LocalState, remote: SyncDoc, now = new Date()): MergeOutput {
  const nowIso = now.toISOString();

  const tombstones = new Map<string, Tombstone>();
  for (const t of [...remote.tombstones, ...local.tombstones]) {
    const seen = tombstones.get(t.id);
    if (!seen || t.deletedAt > seen.deletedAt) tombstones.set(t.id, t);
  }

  const rec = mergeById(base?.records ?? null, local.records, remote.records, tombstones);
  const records = [...rec.items];
  for (const [l, r] of rec.conflicts) {
    records.push(flagConflict(l, l.id, nowIso));
    records.push(flagConflict(r, conflictId(r.id, stamp(r)), nowIso));
  }

  // Trips: the newer edit wins.
  const trip = mergeById(base?.trips ?? null, local.trips, remote.trips, tombstones);
  const trips = [...trip.items, ...trip.conflicts.map(([l, r]) => (stamp(l) >= stamp(r) ? l : r))];

  const present = new Set([...records, ...trips].map((x) => x.id));

  // Receipt files: everything the remote knows, plus local files a record now uses.
  const referenced = new Set(records.map((r) => r.imageId).filter((x): x is string => !!x));
  const files = new Map(remote.files.map((f) => [f.id, { ...f }]));
  for (const f of local.files) {
    if (referenced.has(f.id) && !files.has(f.id)) files.set(f.id, { id: f.id, name: f.name, type: f.type, size: f.size });
  }
  const expiredFiles: string[] = [];
  for (const f of files.values()) {
    if (referenced.has(f.id)) delete f.orphanedAt;
    else f.orphanedAt ??= nowIso;
    if (f.orphanedAt && now.getTime() - Date.parse(f.orphanedAt) > ORPHAN_GRACE_MS) {
      expiredFiles.push(f.id);
      files.delete(f.id);
    }
  }

  // Whichever device edited the details last.
  const profile = [local.profile, remote.profile]
    .filter((p): p is Profile => !!p)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))[0];

  return {
    doc: {
      app: "deductax",
      version: 1,
      savedAt: nowIso,
      profile,
      records,
      trips,
      tombstones: [...tombstones.values()].filter((t) => !present.has(t.id)),
      files: [...files.values()],
    },
    conflicts: rec.conflicts.length,
    expiredFiles,
  };
}
