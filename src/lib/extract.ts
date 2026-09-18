// Extraction pipeline (SPEC §6). Loaded on demand so the SDK and pdf.js stay out of the
// initial bundle. Every failure surfaces as an Error with a message fit to show the user;
// the caller keeps the review card open either way.
import { getApiKey, getFile, getSetting, listTrips } from "./db";
import { hasTextLayer, openPdf, pdfLines, renderFirstPage } from "./pdf";
import { parseInvoiceText, parseRules } from "./pdfParse";
import { loadProfile } from "./profile";
import { prepareImages, type PreparedImages } from "./receiptImage";
import { ExtractionError, describeError, readWithClaude } from "./aiExtract";
import { DEFAULT_MODEL, MODELS, MODEL_SETTING, isModelChoice } from "./models";
import type { ReadResult } from "./draft";

const fail = (message: string): never => {
  throw new ExtractionError(message);
};

export async function readReceipt(fileId: string, { forceAI }: { forceAI: boolean }): Promise<ReadResult> {
  try {
    const file = (await getFile(fileId)) ?? fail("The attached file is missing.");
    let images: PreparedImages;

    if (file.type === "application/pdf") {
      const doc = await openPdf(file.blob).catch(() => fail("Couldn't open that PDF."));
      if (!forceAI) {
        const lines = await pdfLines(doc);
        if (hasTextLayer(lines)) {
          const local = parseInvoiceText(lines, parseRules((await loadProfile()).invoiceRules));
          return {
            patch: local.patch,
            confidence: local.confidence,
            extraction: { status: "done", source: "pdf", matched: local.matched },
          };
        }
      }
      const apiKey = await requireKey();
      const page = await renderFirstPage(doc);
      images = await prepareImages(page, { detect: false });
      return await callClaude(apiKey, images);
    }

    const apiKey = await requireKey();
    const bitmap = await createImageBitmap(file.blob).catch(() =>
      fail("Couldn't open that image. Try a JPEG or PNG, or fill it in by hand.")
    );
    try {
      images = await prepareImages(bitmap, { detect: true });
    } finally {
      bitmap.close();
    }
    return await callClaude(apiKey, images);
  } catch (e) {
    throw new ExtractionError(describeError(e));
  }
}

async function requireKey() {
  const key = await getApiKey();
  if (!key) fail("Add your Anthropic API key in Settings to read receipts automatically.");
  if (!navigator.onLine) fail("You're offline. Fill it in by hand, or read it again once you're connected.");
  return key!;
}

async function callClaude(apiKey: string, images: PreparedImages): Promise<ReadResult> {
  const saved = await getSetting(MODEL_SETTING);
  const model = isModelChoice(saved) ? saved : DEFAULT_MODEL;
  const { patch, confidence } = await readWithClaude(apiKey, model, images, await listTrips(), await loadProfile());
  return {
    patch,
    confidence,
    extraction: {
      status: "done",
      source: "ai",
      matched: true,
      sections: images.tiles.length,
      cropped: images.cropped,
      model: MODELS[model].name,
    },
  };
}
