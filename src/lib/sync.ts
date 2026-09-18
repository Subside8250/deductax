import { applySyncedDoc, deleteMeta, getFile, getMeta, putMeta, putStoredFile, readLocalState } from "./db";
import { download, remove, upload } from "./dropbox";
import { emptyDoc, mergeDocs, parseDoc, type SyncDoc } from "./merge";

// Push/pull with Dropbox (SPEC §8). One run: read the remote document, merge it with this
// device's records against the last synced state, upload any receipts it now needs, then
// write the document back only if nobody else wrote it meanwhile.

const DOC_PATH = "/deductax.json";
const BASE_KEY = "syncBase";
const STATE_KEY = "syncState";
const MAX_ATTEMPTS = 3;

const receiptPath = (id: string) => `/receipts/${id}`;

export type SyncState = { lastSyncAt: string | null; lastError: string | null };
export type SyncResult = { conflicts: number };

export const getSyncState = async (): Promise<SyncState> =>
  (await getMeta<SyncState>(STATE_KEY)) ?? { lastSyncAt: null, lastError: null };

export async function syncNow(): Promise<SyncResult> {
  try {
    const result = await runSync();
    await putMeta<SyncState>(STATE_KEY, { lastSyncAt: new Date().toISOString(), lastError: null });
    return result;
  } catch (e) {
    const state = await getSyncState();
    await putMeta<SyncState>(STATE_KEY, { ...state, lastError: e instanceof Error ? e.message : "Sync failed." });
    throw e;
  }
}

async function runSync(): Promise<SyncResult> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const remoteFile = await download(DOC_PATH);
    const remote = remoteFile ? parseDoc(await remoteFile.blob.text()) : emptyDoc();
    const base = await getMeta<SyncDoc>(BASE_KEY);
    const local = await readLocalState();
    const { doc, conflicts, expiredFiles } = mergeDocs(base, local, remote);

    // Receipts first, so the document never points at a file that isn't there.
    const onRemote = new Set(remote.files.map((f) => f.id));
    for (const meta of doc.files) {
      if (onRemote.has(meta.id)) continue;
      const file = await getFile(meta.id);
      if (file) await upload(receiptPath(file.id), file.blob, { ".tag": "add" }); // "conflict" means already there
    }

    const body = new Blob([JSON.stringify(doc)], { type: "application/json" });
    const written = await upload(DOC_PATH, body, remoteFile ? { ".tag": "update", update: remoteFile.rev } : { ".tag": "add" });
    if (written === "conflict") continue; // another device synced in between; merge again

    await applySyncedDoc(doc, local);
    await putMeta(BASE_KEY, doc);
    for (const id of expiredFiles) await remove(receiptPath(id)).catch(() => {});
    return { conflicts };
  }
  throw new Error("Another device kept syncing at the same moment. Try again shortly.");
}

// Fetches a receipt this device hasn't got yet, using the details from the last sync.
export async function fetchReceipt(id: string) {
  const base = await getMeta<SyncDoc>(BASE_KEY);
  const meta = base?.files.find((f) => f.id === id);
  if (!meta) return null;
  const got = await download(receiptPath(id));
  if (!got) return null;
  const stored = {
    id,
    blob: new Blob([got.blob], { type: meta.type }),
    name: meta.name,
    type: meta.type,
    size: meta.size,
    addedAt: new Date().toISOString(),
  };
  await putStoredFile(stored);
  return stored;
}

// After disconnecting, the next connection starts without assumptions about Dropbox's state.
export async function forgetSyncState() {
  await deleteMeta(BASE_KEY);
  await deleteMeta(STATE_KEY);
}
