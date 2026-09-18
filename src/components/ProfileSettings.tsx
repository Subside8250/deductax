import { useEffect, useState } from "react";
import { Check, ClipboardPaste, Copy } from "lucide-react";
import { EMPTY_PROFILE, loadProfile, profileFromText, profileToText, saveProfile, type Profile } from "../lib/profile";

const field =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-emerald-700 focus:outline-none";

// The taxpayer's own description and rules. Held on the device and injected into the
// prompt at read time, so the app's code says nothing about who is using it.
export default function ProfileSettings() {
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    loadProfile().then(setProfile);
  }, []);

  const set = (patch: Partial<Profile>) => {
    setProfile((p) => ({ ...p, ...patch }));
    setSaved(false);
    setStatus(null);
  };

  const save = async (next: Profile = profile) => {
    const stamped = { ...next, updatedAt: new Date().toISOString() };
    setProfile(stamped);
    await saveProfile(stamped);
    setSaved(true);
  };

  // For moving the details to another device before Dropbox is connected.
  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(profileToText(profile));
      setStatus("Copied. Paste it into this box on your other device.");
    } catch {
      setStatus("Couldn't reach the clipboard on this device.");
    }
  };

  const pasteAll = async () => {
    try {
      const parsed = profileFromText(await navigator.clipboard.readText());
      if (!parsed) return setStatus("That doesn't look like copied details.");
      await save(parsed);
      setStatus("Details pasted and saved.");
    } catch {
      setStatus("Couldn't read the clipboard. Paste into the fields instead.");
    }
  };

  return (
    <section>
      <h2 className="mb-1 font-semibold">Your details</h2>
      <p className="mb-4 text-sm text-slate-600">
        Used to guide how receipts are read and labelled. Not part of the app's code: it lives on your devices and, if Dropbox is
        connected, in your own Dropbox folder, so you only fill it in once. Your API keys are never included. Leave it blank and
        receipts are still read, just with less context.
      </p>

      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="mb-1 block text-slate-600">Your work, in a sentence</span>
          <input value={profile.occupation} placeholder="e.g. an Australian professional on a salary, not a sole trader"
            onChange={(e) => set({ occupation: e.target.value })} className={field} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-slate-600">Where you live and work</span>
            <input value={profile.city} placeholder="your city" onChange={(e) => set({ city: e.target.value })} className={field} />
          </label>
          <label className="block">
            <span className="mb-1 block text-slate-600">Wider area that counts as local</span>
            <input value={profile.region} placeholder="your surrounding region" onChange={(e) => set({ region: e.target.value })} className={field} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-slate-600">Your label rules</span>
          <textarea rows={6} value={profile.rules} onChange={(e) => set({ rules: e.target.value })} className={`${field} font-mono text-xs`}
            placeholder={"- Professional registration, college fees and memberships belong at D5.\n- Conference registration, courses and exam fees belong at D4."} />
          <span className="mt-1 block text-xs text-slate-500">One per line, in plain words. These go to Claude with each receipt.</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-slate-600">Invoice rules for PDFs read on this device (optional)</span>
          <textarea rows={5} value={profile.invoiceRules} onChange={(e) => set({ invoiceRules: e.target.value })} className={`${field} font-mono text-xs`}
            placeholder={"Issuer, other name => D5 | registration | Short description | Why it goes there"} />
          <span className="mt-1 block text-xs text-slate-500">
            One per line: names to look for, then <code>=&gt;</code> the label, kind of expense, description and reason. Used for PDFs with
            selectable text, which are read without AI.
          </span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => save()} className="rounded-lg bg-emerald-800 px-4 py-2.5 font-medium text-white hover:bg-emerald-900">
          Save details
        </button>
        <button type="button" onClick={copyAll} className="flex items-center gap-1.5 text-sm font-medium text-emerald-800 hover:text-emerald-950">
          <Copy size={15} /> Copy all
        </button>
        <button type="button" onClick={pasteAll} className="flex items-center gap-1.5 text-sm font-medium text-emerald-800 hover:text-emerald-950">
          <ClipboardPaste size={15} /> Paste all
        </button>
      </div>
      {saved && <p className="mt-3 flex items-center gap-2 text-sm text-emerald-800"><Check size={15} /> Saved. Dropbox sync will carry this to your other devices.</p>}
      {status && <p className="mt-2 text-sm text-slate-600">{status}</p>}
    </section>
  );
}
