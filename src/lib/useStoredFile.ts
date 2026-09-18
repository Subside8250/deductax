import { useEffect, useState } from "react";
import { getFile } from "./db";
import type { StoredFile } from "./types";

export type StoredFileState =
  | { status: "loading" }
  | { status: "ready"; file: StoredFile; url: string }
  | { status: "missing" };

// Loads a stored receipt and exposes an object URL for it, revoked on change/unmount.
// A receipt filed on another device is fetched from Dropbox the first time it's opened.
export function useStoredFile(id: string | null): StoredFileState | null {
  const [state, setState] = useState<StoredFileState | null>(null);

  useEffect(() => {
    setState(id ? { status: "loading" } : null);
    if (!id) return;
    let url: string | null = null;
    let cancelled = false;
    (async () => {
      let file = await getFile(id);
      if (!file) {
        try {
          const { fetchReceipt } = await import("./sync");
          file = (await fetchReceipt(id)) ?? undefined;
        } catch {
          // Not connected or offline; reported as missing below.
        }
      }
      if (cancelled) return;
      if (!file) return setState({ status: "missing" });
      url = URL.createObjectURL(file.blob);
      setState({ status: "ready", file, url });
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);

  return state;
}
