import type { PDFDocumentProxy } from "pdfjs-dist";

// pdf.js is loaded on first use so it stays out of the initial bundle.
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export async function openPdf(blob: Blob) {
  const pdfjs = await loadPdfjs();
  return pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
}

// Reconstructs text lines from the text layer by grouping items that share a baseline.
export async function pdfLines(doc: PDFDocumentProxy, maxPages = 10) {
  const lines: string[] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows: { y: number; parts: { x: number; s: string }[] }[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const [, , , , x, y] = item.transform as number[];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) rows.push((row = { y, parts: [] }));
      row.parts.push({ x, s: item.str.trim() });
    }
    rows
      .sort((a, b) => b.y - a.y)
      .forEach((r) => lines.push(r.parts.sort((a, b) => a.x - b.x).map((q) => q.s).join(" ")));
  }
  return lines;
}

export const hasTextLayer = (lines: string[]) => lines.join("").replace(/[^A-Za-z0-9]/g, "").length >= 30;

// Scanned PDFs are sent to the API whole, which reads every page, so nothing here
// rasterises them.
