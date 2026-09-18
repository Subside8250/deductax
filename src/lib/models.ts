// Extraction model choice. Kept apart from aiExtract so Settings can show it
// without loading the SDK.
export const MODELS = {
  sonnet: { id: "claude-sonnet-5", name: "Sonnet 5", cost: "about 1¢ US per receipt", note: "Better at applying the travel and location rules." },
  haiku: { id: "claude-haiku-4-5", name: "Haiku 4.5", cost: "about 0.5¢ US per receipt", note: "Cheaper, but less reliable at applying the rules." },
} as const;

export type ModelChoice = keyof typeof MODELS;
export const DEFAULT_MODEL: ModelChoice = "sonnet";
export const MODEL_SETTING = "extractionModel";
export const isModelChoice = (v: unknown): v is ModelChoice => typeof v === "string" && v in MODELS;
