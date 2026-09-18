import { openDB, type DBSchema } from "idb";
import type { ExpenseRecord, StoredFile, Trip } from "./types";
import type { Draft } from "./draft";
import type { LocalState, SyncDoc, Tombstone } from "./merge";

interface DeducTaxDB extends DBSchema {
  records: { key: string; value: ExpenseRecord; indexes: { "by-date": string } };
  files: { key: string; value: StoredFile };
  trips: { key: string; value: Trip };
  // The in-progress review card, so a receipt isn't lost if Android kills the tab.
  drafts: { key: string; value: Draft };
  // Device-only settings (API key). Never synced.
  settings: { key: string; value: string };
  // Deletions, so sync can tell a deleted record from one another device hasn't seen.
  tombstones: { key: string; value: Tombstone };
  // Device-only structured state: Dropbox tokens, the last synced document.
  meta: { key: string; value: unknown };
}

const DRAFT_KEY = "current";
const API_KEY = "anthropicApiKey";
// Kept in step with PROFILE_SETTING in profile.ts; imported here would be circular.
const PROFILE_KEY = "taxpayerProfile";

const dbPromise = openDB<DeducTaxDB>("deductax", 3, {
  upgrade(db, oldVersion) {
    if (oldVersion < 1) {
      const records = db.createObjectStore("records", { keyPath: "id" });
      records.createIndex("by-date", "date");
      db.createObjectStore("files", { keyPath: "id" });
      db.createObjectStore("trips", { keyPath: "id" });
      db.createObjectStore("drafts");
    }
    if (oldVersion < 2) {
      db.createObjectStore("settings");
    }
    if (oldVersion < 3) {
      db.createObjectStore("tombstones", { keyPath: "id" });
      db.createObjectStore("meta");
    }
  },
});

const now = () => new Date().toISOString();

export async function listRecords() {
  return (await dbPromise).getAll("records");
}

export async function saveRecord(record: ExpenseRecord) {
  await (await dbPromise).put("records", record);
}

export async function deleteRecord(id: string) {
  const db = await dbPromise;
  const tx = db.transaction(["records", "files", "tombstones"], "readwrite");
  const record = await tx.objectStore("records").get(id);
  if (record?.imageId) await tx.objectStore("files").delete(record.imageId);
  await tx.objectStore("records").delete(id);
  await tx.objectStore("tombstones").put({ id, kind: "record", deletedAt: now() });
  await tx.done;
}

export async function saveRecords(records: ExpenseRecord[]) {
  if (!records.length) return;
  const tx = (await dbPromise).transaction("records", "readwrite");
  await Promise.all([...records.map((r) => tx.store.put(r)), tx.done]);
}

export async function listTrips() {
  return (await dbPromise).getAll("trips");
}

export async function saveTrip(trip: Trip) {
  await (await dbPromise).put("trips", trip);
}

export async function deleteTrip(id: string) {
  const tx = (await dbPromise).transaction(["trips", "tombstones"], "readwrite");
  await tx.objectStore("trips").delete(id);
  await tx.objectStore("tombstones").put({ id, kind: "trip", deletedAt: now() });
  await tx.done;
}

// Stores the original bytes untouched. The file is copied into a fresh Blob first:
// a File from a camera capture can point at a temporary that stops being readable.
export async function saveFile(file: File): Promise<StoredFile> {
  const blob = new Blob([await file.arrayBuffer()], { type: file.type });
  const stored: StoredFile = {
    id: crypto.randomUUID(),
    blob,
    name: file.name,
    type: file.type,
    size: file.size,
    addedAt: now(),
  };
  await (await dbPromise).put("files", stored);
  return stored;
}

// Keeps a receipt fetched from another device under its original id.
export async function putStoredFile(stored: StoredFile) {
  await (await dbPromise).put("files", stored);
}

export async function getFile(id: string) {
  return (await dbPromise).get("files", id);
}

export async function deleteFile(id: string) {
  await (await dbPromise).delete("files", id);
}

export async function loadDraft() {
  return (await dbPromise).get("drafts", DRAFT_KEY);
}

export async function putDraft(draft: Draft) {
  await (await dbPromise).put("drafts", draft, DRAFT_KEY);
}

export async function clearDraft() {
  await (await dbPromise).delete("drafts", DRAFT_KEY);
}

export async function getApiKey() {
  return (await (await dbPromise).get("settings", API_KEY)) ?? null;
}

export async function setApiKey(key: string) {
  await (await dbPromise).put("settings", key, API_KEY);
}

export async function clearApiKey() {
  await (await dbPromise).delete("settings", API_KEY);
}

export async function getSetting(key: string) {
  return (await (await dbPromise).get("settings", key)) ?? null;
}

export async function putSetting(key: string, value: string) {
  await (await dbPromise).put("settings", value, key);
}

export async function getMeta<T>(key: string) {
  return ((await (await dbPromise).get("meta", key)) as T | undefined) ?? null;
}

export async function putMeta<T>(key: string, value: T) {
  await (await dbPromise).put("meta", value, key);
}

export async function deleteMeta(key: string) {
  await (await dbPromise).delete("meta", key);
}

// Everything sync needs from this device, read in one transaction. File contents
// aren't read, only their details.
export async function readLocalState(): Promise<LocalState> {
  const tx = (await dbPromise).transaction(["records", "trips", "tombstones", "files", "settings"]);
  const [records, trips, tombstones, files, profileJson] = await Promise.all([
    tx.objectStore("records").getAll(),
    tx.objectStore("trips").getAll(),
    tx.objectStore("tombstones").getAll(),
    tx.objectStore("files").getAll(),
    tx.objectStore("settings").get(PROFILE_KEY),
  ]);
  let profile: LocalState["profile"];
  try {
    profile = profileJson ? JSON.parse(profileJson) : undefined;
  } catch {
    profile = undefined;
  }
  return {
    records,
    trips,
    tombstones,
    files: files.map(({ id, name, type, size }) => ({ id, name, type, size })),
    profile,
  };
}

const changedSince = <T extends { id: string; updatedAt?: string }>(snapshot: T[]) => {
  const at = new Map(snapshot.map((x) => [x.id, x.updatedAt ?? ""]));
  return (x: T) => !at.has(x.id) || at.get(x.id) !== (x.updatedAt ?? "");
};

// Writes a merged document back, without undoing anything changed on this device while
// the sync was running: those records stay as they are and go up on the next sync.
export async function applySyncedDoc(doc: SyncDoc, snapshot: LocalState) {
  const tx = (await dbPromise).transaction(["records", "trips", "tombstones", "files", "drafts", "settings"], "readwrite");

  // The taxpayer's details follow the device that edited them last.
  if (doc.profile && (doc.profile.updatedAt ?? "") > (snapshot.profile?.updatedAt ?? "")) {
    await tx.objectStore("settings").put(JSON.stringify(doc.profile), PROFILE_KEY);
  }
  const recordStore = tx.objectStore("records");
  const tripStore = tx.objectStore("trips");
  const tombStore = tx.objectStore("tombstones");

  const deletedNow = new Map((await tombStore.getAll()).map((t) => [t.id, t.deletedAt]));
  const editedRecord = changedSince(snapshot.records);
  const editedTrip = changedSince(snapshot.trips);

  const currentRecords = await recordStore.getAll();
  const touchedRecords = new Set(currentRecords.filter(editedRecord).map((r) => r.id));
  const merged = new Map(doc.records.map((r) => [r.id, r]));
  const removedImages: string[] = [];

  for (const r of doc.records) {
    if (touchedRecords.has(r.id)) continue;
    if ((deletedNow.get(r.id) ?? "") > (r.updatedAt ?? "")) continue; // deleted here during the sync
    await recordStore.put(r);
  }
  for (const r of currentRecords) {
    if (merged.has(r.id) || touchedRecords.has(r.id)) continue;
    await recordStore.delete(r.id);
    if (r.imageId) removedImages.push(r.imageId);
  }

  const currentTrips = await tripStore.getAll();
  const touchedTrips = new Set(currentTrips.filter(editedTrip).map((t) => t.id));
  const mergedTrips = new Set(doc.trips.map((t) => t.id));
  for (const t of doc.trips) {
    if (touchedTrips.has(t.id)) continue;
    if ((deletedNow.get(t.id) ?? "") > (t.updatedAt ?? "")) continue;
    await tripStore.put(t);
  }
  for (const t of currentTrips) {
    if (!mergedTrips.has(t.id) && !touchedTrips.has(t.id)) await tripStore.delete(t.id);
  }

  for (const t of doc.tombstones) {
    if ((deletedNow.get(t.id) ?? "") < t.deletedAt) await tombStore.put(t);
  }
  // A record or trip that came back (edited elsewhere after being deleted here) is no longer deleted.
  for (const x of [...doc.records, ...doc.trips]) {
    const deletedAt = deletedNow.get(x.id);
    if (deletedAt && deletedAt <= (x.updatedAt ?? "")) await tombStore.delete(x.id);
  }

  // Drop the local copies of receipts whose records were removed, unless still in use.
  const draft = await tx.objectStore("drafts").get(DRAFT_KEY);
  const inUse = new Set([
    ...(await recordStore.getAll()).map((r) => r.imageId),
    draft?.imageId,
    draft?.originalImageId,
  ]);
  for (const id of removedImages) if (!inUse.has(id)) await tx.objectStore("files").delete(id);

  await tx.done;
}

// Asks the browser not to evict our data under storage pressure.
export function requestPersistence() {
  navigator.storage?.persist?.().catch(() => {});
}
