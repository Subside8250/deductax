import { useEffect, useState } from "react";
import { Cloud, CloudAlert, CloudOff, LoaderCircle } from "lucide-react";
import type { SyncStatus } from "../lib/useSync";

export function formatAgo(iso: string, now = Date.now()) {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

// Compact sync state for the header. Tapping it opens Settings.
export default function SyncBadge({ status, onClick }: { status: SyncStatus; onClick: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 60_000);
    return () => window.clearInterval(t);
  }, []);
  if (status.state === "off") return null;

  const { icon, text, tone } =
    status.state === "syncing"
      ? { icon: <LoaderCircle size={14} className="animate-spin" />, text: "Syncing", tone: "text-slate-500" }
      : status.state === "offline"
        ? { icon: <CloudOff size={14} />, text: "Offline", tone: "text-slate-500" }
        : status.state === "error"
          ? { icon: <CloudAlert size={14} />, text: "Sync problem", tone: "text-amber-800" }
          : { icon: <Cloud size={14} />, text: status.lastSyncAt ? `Synced ${formatAgo(status.lastSyncAt)}` : "Synced", tone: "text-slate-500" };

  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-1.5 text-xs ${tone} hover:text-slate-900`}>
      {icon} {text}
    </button>
  );
}
