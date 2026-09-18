import { getSetting, putSetting } from "./db";

// Who the taxpayer is, in their own words. Kept on the device and injected into the
// extraction prompt at read time, so nothing identifying lives in the app's code.
export type Profile = {
  occupation: string; // "an Australian ... (a salaried employee, not a sole trader)"
  city: string; // where they live and work
  region: string; // the wider area that still counts as local
  rules: string; // their own label rules, one per line
  invoiceRules: string; // issuer rules for reading PDFs on the device (see pdfParse.ts)
  updatedAt?: string; // so sync can tell which device's version is newer
};

export const EMPTY_PROFILE: Profile = { occupation: "", city: "", region: "", rules: "", invoiceRules: "" };
export const PROFILE_SETTING = "taxpayerProfile";

export async function loadProfile(): Promise<Profile> {
  const raw = await getSetting(PROFILE_SETTING);
  if (!raw) return EMPTY_PROFILE;
  try {
    return { ...EMPTY_PROFILE, ...JSON.parse(raw) };
  } catch {
    return EMPTY_PROFILE;
  }
}

export const saveProfile = (profile: Profile) =>
  putSetting(PROFILE_SETTING, JSON.stringify({ ...profile, updatedAt: profile.updatedAt ?? new Date().toISOString() }));

export const profileIsSet = (p: Profile) => !!p.occupation.trim() || !!p.rules.trim();

// Text form for moving the details between devices by hand, before Dropbox is connected.
export const profileToText = (p: Profile) =>
  JSON.stringify({ occupation: p.occupation, city: p.city, region: p.region, rules: p.rules, invoiceRules: p.invoiceRules }, null, 2);

export function profileFromText(text: string): Profile | null {
  try {
    const d = JSON.parse(text);
    if (typeof d !== "object" || d === null) return null;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    return {
      occupation: str(d.occupation),
      city: str(d.city),
      region: str(d.region),
      rules: str(d.rules),
      invoiceRules: str(d.invoiceRules),
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
