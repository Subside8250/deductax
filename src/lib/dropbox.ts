import { deleteMeta, getMeta, putMeta } from "./db";

// Minimal Dropbox HTTP API client (SPEC §8): PKCE sign-in with offline access, and the
// handful of file calls sync needs. Tokens stay in IndexedDB and are never logged.

const AUTH_KEY = "dropboxAuth";
const PENDING_KEY = "dropboxPending";
export const APP_KEY_SETTING = "dropboxAppKey";

type Auth = { appKey: string; refreshToken: string; accessToken: string; expiresAt: number; accountName: string | null };
type Pending = { appKey: string; verifier: string; state: string; redirectUri: string };

export class DropboxError extends Error {
  constructor(message: string, readonly status: number, readonly summary = "") {
    super(message);
  }
}
export class NotConnectedError extends Error {}

export const redirectUri = () => `${location.origin}${location.pathname}`;

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const randomToken = (bytes: number) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

export async function getConnection() {
  const auth = await getMeta<Auth>(AUTH_KEY);
  return auth ? { accountName: auth.accountName } : null;
}

export async function startConnect(appKey: string) {
  const verifier = randomToken(48);
  const state = randomToken(16);
  const uri = redirectUri();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  await putMeta<Pending>(PENDING_KEY, { appKey, verifier, state, redirectUri: uri });
  const q = new URLSearchParams({
    client_id: appKey,
    response_type: "code",
    redirect_uri: uri,
    code_challenge: base64url(new Uint8Array(digest)),
    code_challenge_method: "S256",
    token_access_type: "offline",
    state,
  });
  location.assign(`https://www.dropbox.com/oauth2/authorize?${q}`);
}

// Completes sign-in when the page loads from Dropbox's redirect.
export async function finishConnect(): Promise<"none" | "connected" | { error: string }> {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const error = params.get("error");
  if (!code && !error) return "none";
  history.replaceState(null, "", location.pathname);

  const pending = await getMeta<Pending>(PENDING_KEY);
  await deleteMeta(PENDING_KEY);
  if (error) {
    return { error: error === "access_denied" ? "Dropbox connection was cancelled." : `Dropbox sign-in failed: ${params.get("error_description") ?? error}` };
  }
  if (!pending || pending.state !== params.get("state")) {
    return { error: "That Dropbox sign-in didn't match this device. Try connecting again." };
  }

  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      code: code!,
      grant_type: "authorization_code",
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
      client_id: pending.appKey,
    }),
  });
  if (!res.ok) return { error: `Dropbox didn't accept the sign-in (${res.status}). Try connecting again.` };
  const t = await res.json();
  const auth: Auth = {
    appKey: pending.appKey,
    refreshToken: t.refresh_token,
    accessToken: t.access_token,
    expiresAt: Date.now() + (Number(t.expires_in) - 60) * 1000,
    accountName: null,
  };
  await putMeta(AUTH_KEY, auth);
  try {
    const account = await rpc<{ name?: { display_name?: string }; email?: string }>("users/get_current_account", null);
    await putMeta(AUTH_KEY, { ...auth, accountName: account.name?.display_name ?? account.email ?? null });
  } catch {
    // The name is only for display.
  }
  return "connected";
}

async function accessToken(refresh = false) {
  const auth = await getMeta<Auth>(AUTH_KEY);
  if (!auth) throw new NotConnectedError("Dropbox isn't connected.");
  if (!refresh && auth.expiresAt > Date.now()) return auth.accessToken;

  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: auth.refreshToken, client_id: auth.appKey }),
  });
  if (res.status === 400 || res.status === 401) {
    // The refresh token was revoked (e.g. the app was disconnected in Dropbox).
    await deleteMeta(AUTH_KEY);
    throw new NotConnectedError("Dropbox access was removed. Connect again in Settings.");
  }
  if (!res.ok) throw new DropboxError(`Dropbox sign-in refresh failed (${res.status}).`, res.status);
  const t = await res.json();
  await putMeta(AUTH_KEY, { ...auth, accessToken: t.access_token, expiresAt: Date.now() + (Number(t.expires_in) - 60) * 1000 });
  return t.access_token as string;
}

// Sends a request with a fresh token, retrying once if the token turned out to be expired.
async function send(url: string, init: (token: string) => RequestInit) {
  let res = await fetch(url, init(await accessToken()));
  if (res.status === 401) res = await fetch(url, init(await accessToken(true)));
  return res;
}

async function toError(res: Response) {
  let summary = "";
  try {
    const body = await res.text();
    try {
      summary = JSON.parse(body).error_summary ?? body;
    } catch {
      summary = body;
    }
  } catch {
    // no body
  }
  return new DropboxError(`Dropbox error ${res.status}${summary ? `: ${summary.slice(0, 120)}` : ""}`, res.status, summary);
}

// Dropbox-API-Arg must be ASCII; other characters are sent as JSON escapes.
const apiArg = (arg: unknown) =>
  JSON.stringify(arg).replace(/[-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

async function rpc<T>(endpoint: string, arg: unknown): Promise<T> {
  const res = await send(`https://api.dropboxapi.com/2/${endpoint}`, (token) => ({
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, ...(arg === null ? {} : { "Content-Type": "application/json" }) },
    body: arg === null ? undefined : JSON.stringify(arg),
  }));
  if (!res.ok) throw await toError(res);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export async function download(path: string): Promise<{ blob: Blob; rev: string } | null> {
  const res = await send("https://content.dropboxapi.com/2/files/download", (token) => ({
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Dropbox-API-Arg": apiArg({ path }) },
  }));
  if (res.status === 409) {
    const e = await toError(res);
    if (e.summary.includes("not_found")) return null;
    throw e;
  }
  if (!res.ok) throw await toError(res);
  const blob = await res.blob();
  let rev: string | undefined;
  try {
    rev = JSON.parse(res.headers.get("Dropbox-API-Result") ?? "null")?.rev;
  } catch {
    // fall through to metadata
  }
  rev ??= (await rpc<{ rev: string }>("files/get_metadata", { path })).rev;
  return { blob, rev };
}

export type WriteMode = { ".tag": "add" } | { ".tag": "update"; update: string };

// Writes a file. Returns "conflict" when the path exists (add) or its revision moved on (update).
export async function upload(path: string, body: Blob, mode: WriteMode): Promise<{ rev: string } | "conflict"> {
  const res = await send("https://content.dropboxapi.com/2/files/upload", (token) => ({
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": apiArg({ path, mode, autorename: false, mute: true, strict_conflict: true }),
    },
    body,
  }));
  if (res.status === 409) {
    const e = await toError(res);
    if (e.summary.includes("conflict")) return "conflict";
    throw e;
  }
  if (!res.ok) throw await toError(res);
  return { rev: (await res.json()).rev };
}

export async function remove(path: string) {
  try {
    await rpc("files/delete_v2", { path });
  } catch (e) {
    if (!(e instanceof DropboxError && e.summary.includes("not_found"))) throw e;
  }
}

export async function disconnect() {
  try {
    await rpc("auth/token/revoke", null);
  } catch {
    // Forget the tokens locally regardless.
  }
  await deleteMeta(AUTH_KEY);
}
