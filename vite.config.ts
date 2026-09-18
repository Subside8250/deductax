import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";

// Published under a path on GitHub Pages; served from the root in development.
const BASE = "/deductax/";

// Default: self-signed HTTPS so the phone gets a secure context over the LAN,
// with `host: true` exposing the dev server on the local network.
// `--mode http` (npm run dev:http) skips the certificate for local-only testing;
// localhost is a secure context without it.
export default defineConfig(({ mode }) => ({
  // The dev server runs at the root; builds (and `vite preview`) use the Pages path.
  base: mode === "development" || mode === "http" ? "/" : BASE,
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === "http" ? [] : [basicSsl()]),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"],
      manifest: {
        name: "DeducTax — deduction capture",
        short_name: "DeducTax",
        description: "Capture work-related expenses and group them by tax return label.",
        start_url: ".",
        scope: ".",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#065f46",
        background_color: "#fafaf9",
        lang: "en-AU",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Everything the app needs to open offline; records and receipts are already local.
        globPatterns: ["**/*.{js,mjs,css,html,png,svg,woff2}"],
        maximumFileSizeToCacheInBytes: 4_000_000,
        navigateFallback: `${BASE}index.html`,
        // Dropbox and Anthropic calls must never be served from the cache.
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [],
      },
    }),
  ],
  // Vite's dependency cache and local build output live outside Dropbox, which locks
  // files mid-rename. CI has no Dropbox, so there the build lands in ./dist as usual.
  cacheDir: join(tmpdir(), "deductax-vite"),
  build: { outDir: process.env.CI ? "dist" : join(tmpdir(), "deductax-dist"), emptyOutDir: true },
  server: { host: true },
  preview: { host: true },
}));
