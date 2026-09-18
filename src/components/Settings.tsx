import { useEffect, useState } from "react";
import { ArrowLeft, Check, CircleAlert, LoaderCircle } from "lucide-react";
import { clearApiKey, getApiKey, getSetting, putSetting, setApiKey } from "../lib/db";
import { DEFAULT_MODEL, MODELS, MODEL_SETTING, isModelChoice, type ModelChoice } from "../lib/models";
import DropboxSettings, { type SyncControls } from "./DropboxSettings";
import ProfileSettings from "./ProfileSettings";

const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-emerald-700 focus:outline-none";

type Status = { kind: "idle" } | { kind: "busy" } | { kind: "ok"; text: string } | { kind: "error"; text: string };

export default function Settings({ onClose, sync }: { onClose: () => void; sync: SyncControls }) {
  const [saved, setSaved] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [model, setModel] = useState<ModelChoice>(DEFAULT_MODEL);

  useEffect(() => {
    getApiKey().then(setSaved);
    getSetting(MODEL_SETTING).then((m) => isModelChoice(m) && setModel(m));
  }, []);

  const chooseModel = (m: ModelChoice) => {
    setModel(m);
    putSetting(MODEL_SETTING, m);
  };

  const check = async (key: string) => {
    setStatus({ kind: "busy" });
    try {
      const { checkApiKey, describeError } = await import("../lib/aiExtract");
      try {
        await checkApiKey(key);
        setStatus({ kind: "ok", text: "Key works." });
      } catch (e) {
        setStatus({ kind: "error", text: describeError(e, { inSettings: true }) });
      }
    } catch {
      setStatus({ kind: "error", text: "Couldn't load the checker. Are you offline?" });
    }
  };

  const save = async () => {
    const key = input.trim();
    if (!key) return;
    await setApiKey(key);
    setSaved(key);
    setInput("");
    await check(key);
  };

  const remove = async () => {
    if (!window.confirm("Remove the API key from this device?")) return;
    await clearApiKey();
    setSaved(null);
    setStatus({ kind: "idle" });
  };

  return (
    <div className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm">
      <button type="button" onClick={onClose} className="mb-4 flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900">
        <ArrowLeft size={15} /> Back
      </button>
      <DropboxSettings sync={sync} />

      <h2 className="mb-1 mt-8 font-semibold">Anthropic API key</h2>
      <p className="mb-4 text-sm text-slate-600">
        Used to read photos and scanned PDFs. Stored only on this device and never synced. PDFs with selectable text are read on the device without it.
      </p>

      {saved && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg bg-stone-100 px-3 py-2 text-sm">
          <span className="truncate">
            Saved key <span className="font-mono">…{saved.slice(-4)}</span>
          </span>
          <span className="flex shrink-0 gap-3">
            <button type="button" onClick={() => check(saved)} className="font-medium text-emerald-800 hover:text-emerald-950">Check</button>
            <button type="button" onClick={remove} className="font-medium text-red-700 hover:text-red-900">Remove</button>
          </span>
        </div>
      )}

      <label className="text-sm">
        <span className="mb-1 block text-slate-600">{saved ? "Replace with a new key" : "Paste your key"}</span>
        <input type="password" autoComplete="off" spellCheck={false} value={input} placeholder="sk-ant-…"
          onChange={(e) => setInput(e.target.value)} className={field} />
      </label>
      <button type="button" onClick={save} disabled={!input.trim() || status.kind === "busy"}
        className="mt-3 rounded-lg bg-emerald-800 px-4 py-2.5 font-medium text-white hover:bg-emerald-900 disabled:opacity-50">
        Save key
      </button>

      {status.kind === "busy" && (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-600"><LoaderCircle size={15} className="animate-spin" /> Checking…</p>
      )}
      {status.kind === "ok" && (
        <p className="mt-3 flex items-center gap-2 text-sm text-emerald-800"><Check size={15} /> {status.text}</p>
      )}
      {status.kind === "error" && (
        <p className="mt-3 flex items-start gap-2 text-sm text-amber-900"><CircleAlert size={15} className="mt-0.5 shrink-0" /> {status.text}</p>
      )}

      <div className="mt-8">
        <ProfileSettings />
      </div>

      <h2 className="mb-1 mt-8 font-semibold">Reading model</h2>
      <p className="mb-3 text-sm text-slate-600">Which Claude model reads photos and scanned PDFs.</p>
      <div className="space-y-2" role="radiogroup" aria-label="Reading model">
        {(Object.keys(MODELS) as ModelChoice[]).map((m) => (
          <label key={m}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm ${model === m ? "border-emerald-700 bg-emerald-50" : "border-slate-300"}`}>
            <input type="radio" name="model" checked={model === m} onChange={() => chooseModel(m)} className="mt-1 accent-emerald-800" />
            <span>
              <span className="block font-medium">{MODELS[m].name} <span className="font-normal text-slate-500">· {MODELS[m].cost}</span></span>
              <span className="block text-slate-600">{MODELS[m].note}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
