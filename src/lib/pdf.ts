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
export async function pdfLines(doc: PDFDocumentProxy, maxPages = 3) {
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

// Renders page 1 for the vision path (scanned PDFs with no text layer).
export async function renderFirstPage(doc: PDFDocumentProxy) {
  const page = await doc.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: 2200 / Math.max(base.width, base.height) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}
