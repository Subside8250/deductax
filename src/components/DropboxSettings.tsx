import { useEffect, useState } from "react";
import { CircleAlert, Copy, LoaderCircle, RefreshCw } from "lucide-react";
import { getSetting, putSetting } from "../lib/db";
import { APP_KEY_SETTING, disconnect, redirectUri, startConnect } from "../lib/dropbox";
import { forgetSyncState } from "../lib/sync";
import type { SyncStatus } from "../lib/useSync";
import { formatAgo } from "./SyncBadge";

const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-emerald-700 focus:outline-none";

export type SyncControls = {
  status: SyncStatus;
  accountName: string | null;
  syncNow: () => void;
  refreshConnection: () => Promise<boolean>;
};

export default function DropboxSettings({ sync }: { sync: SyncControls }) {
  const [appKey, setAppKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const { status } = sync;
  const connected = status.state !== "off";
  const uri = redirectUri();

  useEffect(() => {
    getSetting(APP_KEY_SETTING).then((k) => k && setAppKey(k));
  }, []);

  const connect = async () => {
    const key = appKey.trim();
    if (!key) return;
    setConnecting(true);
    await putSetting(APP_KEY_SETTING, key);
    await startConnect(key); // leaves the page for Dropbox
  };

  const copyUri = async () => {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable; the address is shown to copy by hand.
    }
  };

  const disconnectNow = async () => {
    if (!window.confirm("Disconnect Dropbox on this device? Your records stay here and in Dropbox; they just stop syncing.")) return;
    await disconnect();
    await forgetSyncState();
    await sync.refreshConnection();
  };

  return (
    <section>
      <h2 className="mb-1 font-semibold">Dropbox sync</h2>
      <p className="mb-4 text-sm text-slate-600">
        Keeps your records and receipts in step between your phone and PC. The app can only see its own folder in your Dropbox.
      </p>

      {connected ? (
        <div className="space-y-3">
          <div className="rounded-lg bg-stone-100 px-3 py-2 text-sm">
            Connected{sync.accountName ? ` as ${sync.accountName}` : ""}.{" "}
            {status.state === "syncing" ? "Syncing now…" : status.lastSyncAt ? `Last synced ${formatAgo(status.lastSyncAt)}.` : "Not synced yet."}
          </div>
          {status.state === "error" && (
            <p className="flex items-start gap-2 text-sm text-amber-900">
              <CircleAlert size={15} className="mt-0.5 shrink-0" /> {status.message}
            </p>
          )}
          {status.state === "offline" && <p className="text-sm text-slate-600">You're offline. Changes will sync when you're back online.</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={sync.syncNow} disabled={status.state === "syncing"}
              className="flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2.5 font-medium text-white hover:bg-emerald-900 disabled:opacity-50">
              {status.state === "syncing" ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />} Sync now
            </button>
            <button type="button" onClick={disconnectNow} className="rounded-lg px-4 py-2.5 font-medium text-red-700 hover:text-red-900">
              Disconnect
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <details className="rounded-lg bg-stone-100 px-3 py-2">
            <summary className="cursor-pointer font-medium">One-time setup in Dropbox</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
              <li>Open the Dropbox App Console (dropbox.com/developers/apps) and create an app with <b>Scoped access</b> and <b>App folder</b> access.</li>
              <li>On the <b>Permissions</b> tab, tick <b>files.content.write</b> and <b>files.content.read</b>, then Submit.</li>
              <li>On the <b>Settings</b> tab, add the address below under <b>Redirect URIs</b>. Add it again for each address you open the app from.</li>
              <li>Copy the <b>App key</b> from the Settings tab into the box below.</li>
            </ol>
          </details>
          <div>
            <span className="mb-1 block text-slate-600">This app's address (redirect URI)</span>
            <div className="flex gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-300 bg-white px-3 py-2">{uri}</code>
              <button type="button" onClick={copyUri}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium hover:border-slate-400">
                <Copy size={14} /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <label className="block">
            <span className="mb-1 block text-slate-600">Dropbox app key</span>
            <input value={appKey} autoComplete="off" spellCheck={false} onChange={(e) => setAppKey(e.target.value)} className={field} />
          </label>
          <button type="button" onClick={connect} disabled={!appKey.trim() || connecting}
            className="rounded-lg bg-emerald-800 px-4 py-2.5 font-medium text-white hover:bg-emerald-900 disabled:opacity-50">
            {connecting ? "Opening Dropbox…" : "Connect Dropbox"}
          </button>
        </div>
      )}
    </section>
  );
}
