// Extraction pipeline (SPEC §6). Loaded on demand so the SDK and pdf.js stay out of the
// initial bundle. Every failure surfaces as an Error with a message fit to show the user;
// the caller keeps the review card open either way.
import { getApiKey, getFile, getSetting, listTrips } from "./db";
import { hasTextLayer, openPdf, pdfLines } from "./pdf";
import { parseInvoiceText, parseRules } from "./pdfParse";
import { loadProfile } from "./profile";
import { prepareImages } from "./receiptImage";
import { ExtractionError, describeError, readWithClaude, type Subject } from "./aiExtract";
import { DEFAULT_MODEL, MODELS, MODEL_SETTING, isModelChoice } from "./models";
import type { ReadResult } from "./draft";

// A PDF goes to the API whole, so the limits are the request's, not ours.
const MAX_PDF_PAGES = 100;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const TEXT_PAGES = 10;

const fail = (message: string): never => {
  throw new ExtractionError(message);
};

const blobToBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new ExtractionError("Couldn't read that file off the device."));
    r.readAsDataURL(blob);
  });

export async function readReceipt(fileId: string, { forceAI }: { forceAI: boolean }): Promise<ReadResult> {
  try {
    const file = (await getFile(fileId)) ?? fail("The attached file is missing.");

    if (file.type === "application/pdf") {
      const doc = await openPdf(file.blob).catch(() => fail("Couldn't open that PDF."));
      const lines = await pdfLines(doc, TEXT_PAGES);
      const pages = doc.numPages;

      // A PDF with real text is read here: free, exact, and nothing leaves the device.
      if (hasTextLayer(lines)) {
        if (!forceAI) {
          const local = parseInvoiceText(lines, parseRules((await loadProfile()).invoiceRules));
          return {
            patch: local.patch,
            confidence: local.confidence,
            extraction: { status: "done", source: "pdf", matched: local.matched },
          };
        }
        // Asked for AI anyway: send the text rather than pictures of it.
        const apiKey = await requireKey();
        const read = Math.min(pages, TEXT_PAGES);
        return await callClaude(
          apiKey,
          { kind: "text", text: lines.join("\n"), pages: read },
          read === 1 ? "the PDF text" : `the text of ${read} PDF page${read === 1 ? "" : "s"}`
        );
      }

      // Scanned: the API reads every page, so nothing past page 1 is lost.
      const apiKey = await requireKey();
      if (pages > MAX_PDF_PAGES) {
        fail(`This PDF has ${pages} pages, which is more than can be read in one go. Split it, or enter the details by hand.`);
      }
      if (file.size > MAX_PDF_BYTES) {
        fail("That PDF is too large to send (over 20 MB). Try a smaller scan, or enter the details by hand.");
      }
      return await callClaude(
        apiKey,
        { kind: "pdf", base64: await blobToBase64(file.blob), pages },
        `${pages} scanned page${pages === 1 ? "" : "s"}`
      );
    }

    const apiKey = await requireKey();
    const bitmap = await createImageBitmap(file.blob).catch(() =>
      fail("Couldn't open that image. Try a JPEG or PNG, or fill it in by hand.")
    );
    try {
      const images = await prepareImages(bitmap, { detect: true });
      return await callClaude(
        apiKey,
        { kind: "images", images },
        images.tiles.length > 1 ? `${images.tiles.length} sections of a long receipt` : undefined
      );
    } finally {
      bitmap.close();
    }
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

async function callClaude(apiKey: string, subject: Subject, detail?: string): Promise<ReadResult> {
  const saved = await getSetting(MODEL_SETTING);
  const model = isModelChoice(saved) ? saved : DEFAULT_MODEL;
  const { patch, confidence } = await readWithClaude(apiKey, model, subject, await listTrips(), await loadProfile());
  return {
    patch,
    confidence,
    extraction: { status: "done", source: "ai", matched: true, detail, model: MODELS[model].name },
  };
}
