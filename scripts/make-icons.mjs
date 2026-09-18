// Generates the app icons (a receipt on the app's green) with no image dependencies:
// pixels are computed here and written as PNG using Node's own zlib.
// Run: node scripts/make-icons.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const GREEN = [6, 95, 70]; // emerald-800, the app's primary
const PAPER = [250, 250, 249];
const INK = [15, 74, 57];

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

function pixels(size, { maskable }) {
  const data = new Uint8Array(size * size * 4);
  const s = (n) => n * size;
  // Inside the safe area a maskable icon can be cropped to a circle, so its art is smaller.
  const scale = maskable ? 0.72 : 1;
  const radius = s(0.2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let colour = GREEN;
      let alpha = 255;

      if (!maskable) {
        // Rounded square with a soft edge.
        const dx = Math.max(radius - x, x - (size - radius), 0);
        const dy = Math.max(radius - y, y - (size - radius), 0);
        const d = Math.hypot(dx, dy) - radius;
        if (d > 0.5) alpha = 0;
        else if (d > -0.5) alpha = Math.round(255 * (0.5 - d));
      }

      // Receipt, centred, with a torn bottom edge.
      const cx = (x - size / 2) / scale + size / 2;
      const cy = (y - size / 2) / scale + size / 2;
      const left = s(0.3), right = s(0.7), top = s(0.22);
      const tear = s(0.72) - Math.abs(((cx - left) % s(0.1)) - s(0.05)) * 0.8;
      if (cx > left && cx < right && cy > top && cy < tear) {
        colour = PAPER;
        // Lines of text, the last one short like a total.
        const lines = [
          [0.34, 0.37, 0.36, 0.64],
          [0.43, 0.46, 0.36, 0.64],
          [0.52, 0.55, 0.36, 0.56],
          [0.61, 0.65, 0.48, 0.64],
        ];
        for (const [y0, y1, x0, x1] of lines) {
          if (cy > s(y0) && cy < s(y1) && cx > s(x0) && cx < s(x1)) colour = INK;
        }
      }

      const i = (y * size + x) * 4;
      [data[i], data[i + 1], data[i + 2]] = alpha === 255 ? colour : mix(colour, colour, 0);
      data[i + 3] = alpha;
    }
  }
  return data;
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([len, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const table = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

mkdirSync("public", { recursive: true });
for (const [file, size, maskable] of [
  ["public/icon-192.png", 192, false],
  ["public/icon-512.png", 512, false],
  ["public/icon-maskable-512.png", 512, true],
  ["public/apple-touch-icon.png", 180, true],
]) {
  writeFileSync(file, png(size, pixels(size, { maskable })));
  console.log("wrote", file);
}
