import { useCallback, useEffect, useRef, useState } from "react";
import { NotConnectedError, finishConnect, getConnection } from "./dropbox";
import { getSyncState, syncNow } from "./sync";

export type SyncStatus =
  | { state: "off" }
  | { state: "syncing"; lastSyncAt: string | null }
  | { state: "idle"; lastSyncAt: string | null }
  | { state: "offline"; lastSyncAt: string | null }
  | { state: "error"; lastSyncAt: string | null; message: string };

const CHANGE_DELAY_MS = 3000;
const RESUME_MIN_GAP_MS = 60_000;

// Runs sync in the background: on open, after changes (debounced), when the device comes
// back online, and when the app returns to the foreground. Never blocks the UI.
export function useSync({ onSynced, onNotice }: { onSynced: () => void; onNotice: (message: string) => void }) {
  const [status, setStatus] = useState<SyncStatus>({ state: "off" });
  const [accountName, setAccountName] = useState<string | null>(null);
  const running = useRef(false);
  const again = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const connected = useRef(false);
  const lastSync = useRef<string | null>(null);
  const callbacks = useRef({ onSynced, onNotice });
  callbacks.current = { onSynced, onNotice };

  const run = useCallback(async () => {
    if (!connected.current) return;
    if (running.current) {
      again.current = true;
      return;
    }
    if (!navigator.onLine) {
      setStatus({ state: "offline", lastSyncAt: lastSync.current });
      return;
    }
    running.current = true;
    setStatus({ state: "syncing", lastSyncAt: lastSync.current });
    try {
      const { conflicts } = await syncNow();
      lastSync.current = new Date().toISOString();
      setStatus({ state: "idle", lastSyncAt: lastSync.current });
      callbacks.current.onSynced();
      if (conflicts) {
        callbacks.current.onNotice(
          `${conflicts} record${conflicts === 1 ? " was" : "s were"} changed on two devices at once. Both versions are under Needs review.`
        );
      }
    } catch (e) {
      if (e instanceof NotConnectedError) {
        connected.current = false;
        setAccountName(null);
        setStatus({ state: "off" });
        callbacks.current.onNotice(e.message);
      } else {
        const message = e instanceof Error ? e.message : "Sync failed.";
        setStatus(navigator.onLine ? { state: "error", lastSyncAt: lastSync.current, message } : { state: "offline", lastSyncAt: lastSync.current });
      }
    } finally {
      running.current = false;
      if (again.current) {
        again.current = false;
        run();
      }
    }
  }, []);

  const requestSync = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, CHANGE_DELAY_MS);
  }, [run]);

  const refreshConnection = useCallback(async () => {
    const conn = await getConnection();
    connected.current = !!conn;
    setAccountName(conn?.accountName ?? null);
    if (!conn) setStatus({ state: "off" });
    return !!conn;
  }, []);

  useEffect(() => {
    (async () => {
      lastSync.current = (await getSyncState()).lastSyncAt;
      const result = await finishConnect().catch(() => ({ error: "Couldn't finish connecting to Dropbox." }));
      if (typeof result === "object") callbacks.current.onNotice(result.error);
      if (result === "connected") callbacks.current.onNotice("Dropbox connected. Your records will sync in the background.");
      if (await refreshConnection()) {
        setStatus({ state: "idle", lastSyncAt: lastSync.current });
        run();
      }
    })();

    const onOnline = () => run();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const last = lastSync.current ? Date.parse(lastSync.current) : 0;
      if (Date.now() - last > RESUME_MIN_GAP_MS) run();
    };
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearTimeout(timer.current);
    };
  }, [run, refreshConnection]);

  return { status, accountName, syncNow: run, requestSync, refreshConnection };
}
