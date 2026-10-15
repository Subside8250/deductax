import Anthropic from "@anthropic-ai/sdk";
import { buildPrompt } from "./prompt";
import { EXPENSE_KINDS, sectionByCode } from "./sections";
import type { ExpenseKind, ExpenseRecord, Trip } from "./types";
import type { ExtractionPatch } from "./draft";
import type { PreparedImages } from "./receiptImage";

import { MODELS, type ModelChoice } from "./models";
import type { Profile } from "./profile";

export class ExtractionError extends Error {}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set<string>(EXPENSE_KINDS.map(([k]) => k));
const CONFIDENCE = new Set(["high", "medium", "low"]);

export function parseReply(text: string) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ExtractionError("The reply didn't contain the receipt details.");
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new ExtractionError("The reply couldn't be read.");
  }
}

export function toPatch(p: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : NaN);

  const patch: ExtractionPatch = {};
  if (str(p.vendor)) patch.vendor = str(p.vendor);
  if (ISO.test(str(p.date))) patch.date = str(p.date);
  const total = num(p.total);
  if (total > 0) patch.total = total.toFixed(2);
  const gst = num(p.gst);
  if (gst > 0) patch.gst = gst.toFixed(2);
  if (str(p.description)) patch.description = str(p.description);
  patch.section = sectionByCode(str(p.section)).code;
  const kind = str(p.expenseKind);
  patch.expenseKind = (KINDS.has(kind) ? kind : "other") as ExpenseKind;
  if (patch.expenseKind === "accommodation") {
    if (ISO.test(str(p.checkIn))) patch.checkIn = str(p.checkIn);
    if (ISO.test(str(p.checkOut))) patch.checkOut = str(p.checkOut);
  }
  if (str(p.note)) patch.note = str(p.note);
  const pct = num(p.workUsePercent);
  if (pct > 0 && pct < 100) patch.workUsePercent = Math.round(pct * 100) / 100;

  const c = str(p.confidence);
  const confidence = (CONFIDENCE.has(c) ? c : "low") as ExpenseRecord["confidence"];
  return { patch, confidence };
}

// What is being read: a photo (possibly split into sections), a PDF sent whole for the
// API to rasterise, or the text layer of a PDF, which is exact and far cheaper.
export type Subject =
  | { kind: "images"; images: PreparedImages }
  | { kind: "pdf"; base64: string; pages: number }
  | { kind: "text"; text: string; pages: number };

function subjectBlocks(subject: Subject): Anthropic.ContentBlockParam[] {
  if (subject.kind === "pdf") {
    return [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: subject.base64 } }];
  }
  if (subject.kind === "text") {
    return [
      {
        type: "text",
        text: `The text below was extracted from the ${subject.pages === 1 ? "PDF" : `${subject.pages}-page PDF`} of this receipt or invoice. Read it as the document itself.\n\n${subject.text}`,
      },
    ];
  }
  const { images } = subject;
  const blocks: Anthropic.ContentBlockParam[] = images.tiles.map((data) => ({
    type: "image",
    source: { type: "base64", media_type: "image/jpeg", data },
  }));
  if (images.axis) {
    const order = images.axis === "vertical" ? "top to bottom" : "left to right";
    blocks.push({
      type: "text",
      text: `The ${images.tiles.length} images above are overlapping sections of one ${images.axis === "vertical" ? "long" : "wide"} receipt, in order from ${order}. Read them together as a single document.`,
    });
  }
  return blocks;
}

export async function readWithClaude(apiKey: string, model: ModelChoice, subject: Subject, trips: Trip[], profile: Profile) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: 120_000 });

  const content: Anthropic.ContentBlockParam[] = subjectBlocks(subject);
  content.push({ type: "text", text: buildPrompt(trips, profile) });

  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];
  const res =
    model === "sonnet"
      ? // Sonnet 5 thinks adaptively; low effort keeps that brief. Thinking shares the
        // max_tokens budget, so it needs more room than the JSON alone.
        await client.messages.create({
          model: MODELS.sonnet.id,
          max_tokens: 4096,
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
          messages,
        })
      : await client.messages.create({ model: MODELS.haiku.id, max_tokens: 1024, messages });

  if (res.stop_reason === "refusal") throw new ExtractionError("Claude declined to read this one.");
  if (res.stop_reason === "max_tokens") throw new ExtractionError("The reply was cut off.");

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return toPatch(parseReply(text));
}

// Free call used by Settings to confirm a key works.
export async function checkApiKey(apiKey: string) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: 20_000, maxRetries: 0 });
  await client.models.list({ limit: 1 });
}

export function describeError(e: unknown, { inSettings = false } = {}): string {
  if (e instanceof ExtractionError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) {
    return inSettings ? "Anthropic rejected this key. Check it was copied in full." : "Your Anthropic API key was rejected. Check it in Settings.";
  }
  if (e instanceof Anthropic.PermissionDeniedError) return "Your API key isn't allowed to use this model.";
  if (e instanceof Anthropic.RateLimitError) return "Too many requests right now. Try again in a minute.";
  if (e instanceof Anthropic.BadRequestError) return `Anthropic couldn't process this: ${e.message.slice(0, 160)}`;
  if (e instanceof Anthropic.APIConnectionError) {
    return navigator.onLine ? "Couldn't reach Anthropic. Check your connection and try again." : "You're offline.";
  }
  if (e instanceof Anthropic.APIError) return `Anthropic returned an error${e.status ? ` (${e.status})` : ""}. Try again shortly.`;
  return "Something went wrong reading this one.";
}
