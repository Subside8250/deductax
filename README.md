# DeducTax

A private, installable web app for capturing work-related expenses through the financial year and grouping them by the labels of the Australian individual tax return.

Built for a single user. There is no server and no account: every record, receipt and key stays on the device, with an optional sync through the user's own Dropbox.

## What it does

- **Capture** a receipt with the camera, a photo, or a PDF, or type one in by hand.
- **Read** photos and scanned PDFs with Claude; PDFs with selectable text are read on the device with no AI call.
- **Check before filing.** Every record is shown for review, and a label is never assigned without a stated reason.
- **Trips.** Receipts dated inside a trip are linked to it, and travel splits (accommodation nights, flights, meals) are proposed for confirmation.
- **Outputs.** Totals by tax return label, a CSV, a printable summary and a printable travel diary.
- **Sync.** Optional Dropbox sync between devices, merged record by record.

Nothing here is tax advice; the app suggests and the user decides.

## Running it locally

```bash
npm install
npm run dev        # https://localhost:5173 and your LAN address (self-signed certificate)
npm run dev:http   # http://localhost:5174, no certificate
npm run build      # production build into dist/
npm run preview    # serve the production build
```

Icons are generated with `node scripts/make-icons.mjs`.

## Setting it up on a device

1. **Anthropic API key** (for reading photos): create one at console.anthropic.com and paste it into Settings.
2. **Your details** (optional but recommended): in Settings, describe your work, where you live, and your own rules for which label an expense belongs under. These guide the reading and are held on the device, so the app's code contains nothing about who uses it.
3. **Dropbox sync** (optional): create an app at dropbox.com/developers/apps with **Scoped access** and **App folder** access, tick `files.content.write` and `files.content.read`, add the app's address under **Redirect URIs**, then paste the app key into Settings and connect.

Keys and personal details are stored on the device only and are never committed.

## Hosting

Pushing to `main` builds the app and publishes it to GitHub Pages (`.github/workflows/deploy.yml`).

## Layout

- `src/lib/` — data model, IndexedDB, extraction, apportionment engine, sync.
- `src/components/` — review card, totals, trips, reports, settings.
