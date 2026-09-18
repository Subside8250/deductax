// Prepares a receipt image for the vision API: finds the receipt within the photo,
// crops to it, and splits long or wide receipts into overlapping sections so the
// API's own downscaling doesn't shrink the text past legibility.
// The stored original is never modified; this only builds the copies that are sent.

export type ImageSource = ImageBitmap | HTMLCanvasElement;
export type Box = { x: number; y: number; w: number; h: number };
export type PreparedImages = {
  tiles: string[]; // base64 JPEG
  axis: "vertical" | "horizontal" | null; // split direction, null when sent whole
  crop: Box;
  cropped: boolean;
};

// The API downsamples anything beyond roughly these limits, so sending more is wasted upload.
const MAX_EDGE = 1568;
const MAX_PIXELS = 1_150_000;
const SPLIT_ASPECT = 2.2; // long side : short side beyond which a receipt is split
const TILE_ASPECT = 1.6; // target proportions of each section, before overlap
const MAX_TILES = 5;
const OVERLAP = 0.12; // of a section's length, added at each inner edge
const ANALYSIS_EDGE = 320;

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function otsuThreshold(hist: number[], total: number) {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

// Finds the receipt as the largest bright, roughly rectangular region against a darker
// background. Returns null when there is no clear answer — the receipt fills the frame,
// the background is as light as the paper, or the region isn't paper-shaped — in which
// case the caller uses the whole image.
export function findReceipt(src: ImageSource): Box | null {
  const W = src.width;
  const H = src.height;
  const s = Math.min(1, ANALYSIS_EDGE / Math.max(W, H));
  const w = Math.max(1, Math.round(W * s));
  const h = Math.max(1, Math.round(H * s));
  const ctx = makeCanvas(w, h).getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const n = w * h;
  const gray = new Uint8Array(n);
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < n; i++) {
    const g = ((data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000) | 0;
    gray[i] = g;
    hist[g]++;
  }
  const t = otsuThreshold(hist, n);

  let brightCount = 0;
  for (let i = 0; i < n; i++) if (gray[i] > t) brightCount++;
  if (brightCount / n > 0.75) return null;

  // Largest 4-connected bright component.
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let best = { area: 0, x0: 0, y0: 0, x1: 0, y1: 0 };
  for (let start = 0; start < n; start++) {
    if (seen[start] || gray[start] <= t) continue;
    let sp = 0;
    stack[sp++] = start;
    seen[start] = 1;
    let area = 0;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (sp) {
      const p = stack[--sp];
      const x = p % w;
      const y = (p - x) / w;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const push = (q: number) => {
        if (!seen[q] && gray[q] > t) {
          seen[q] = 1;
          stack[sp++] = q;
        }
      };
      if (x > 0) push(p - 1);
      if (x < w - 1) push(p + 1);
      if (y > 0) push(p - w);
      if (y < h - 1) push(p + w);
    }
    if (area > best.area) best = { area, x0, y0, x1, y1 };
  }

  const bw = best.x1 - best.x0 + 1;
  const bh = best.y1 - best.y0 + 1;
  if (best.area / n < 0.04) return null; // nothing big enough to be the receipt
  if (best.area / (bw * bh) < 0.5) return null; // not paper-shaped
  if (bw >= 0.92 * w && bh >= 0.92 * h) return null; // fills the frame already

  const m = 0.02 * Math.max(bw, bh);
  const x = Math.max(0, (best.x0 - m) / s);
  const y = Math.max(0, (best.y0 - m) / s);
  return {
    x,
    y,
    w: Math.min(W, (best.x1 + 1 + m) / s) - x,
    h: Math.min(H, (best.y1 + 1 + m) / s) - y,
  };
}

// Splits a region along its long side into overlapping sections when it is long or wide.
export function planTiles(box: Box): { regions: Box[]; axis: PreparedImages["axis"] } {
  const vertical = box.h >= box.w;
  const long = vertical ? box.h : box.w;
  const short = vertical ? box.w : box.h;
  const aspect = long / short;
  if (aspect <= SPLIT_ASPECT) return { regions: [box], axis: null };

  const n = Math.min(MAX_TILES, Math.ceil(aspect / TILE_ASPECT));
  const step = long / n;
  const overlap = step * OVERLAP;
  const regions: Box[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i * step - overlap);
    const b = Math.min(long, (i + 1) * step + overlap);
    regions.push(
      vertical
        ? { x: box.x, y: box.y + a, w: box.w, h: b - a }
        : { x: box.x + a, y: box.y, w: b - a, h: box.h }
    );
  }
  return { regions, axis: vertical ? "vertical" : "horizontal" };
}

function blobToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("Could not encode the image."));
    r.readAsDataURL(blob);
  });
}

async function encodeRegion(src: ImageSource, r: Box) {
  const scale = Math.min(1, MAX_EDGE / Math.max(r.w, r.h), Math.sqrt(MAX_PIXELS / (r.w * r.h)));
  const cw = Math.max(1, Math.round(r.w * scale));
  const ch = Math.max(1, Math.round(r.h * scale));
  const c = makeCanvas(cw, ch);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, cw, ch);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("Could not encode the image.");
  return blobToBase64(blob);
}

export async function prepareImages(src: ImageSource, { detect }: { detect: boolean }): Promise<PreparedImages> {
  const whole: Box = { x: 0, y: 0, w: src.width, h: src.height };
  const found = detect ? findReceipt(src) : null;
  const crop = found ?? whole;
  const { regions, axis } = planTiles(crop);
  const tiles: string[] = [];
  for (const r of regions) tiles.push(await encodeRegion(src, r));
  return { tiles, axis, crop, cropped: !!found };
}
