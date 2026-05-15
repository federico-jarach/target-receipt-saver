# Receipt Saver for Target

Unofficial, local-only Chrome extension for saving your own Target order receipts in bulk.

This extension helps you avoid manually opening and saving every receipt. You log into Target yourself, open your order history, collect visible order links, let the extension walk the nested receipt/invoice pages one at a time, and export a ZIP containing local HTML snapshots plus metadata.

> Not affiliated with, endorsed by, or sponsored by Target Corporation. “Target” is used only to describe compatibility with Target.com order-history pages.

## What it does

```txt
Target order history
→ collect visible order / receipt links
→ open each parent order one at a time
→ crawl nested receipt / invoice links under that order
→ save every discovered receipt-like page
→ export a local ZIP
```

The exported ZIP includes:

```txt
manifest.csv
manifest.json
receipts/
  target_order_0001_<id>.html
raw/
  target_order_0001_<id>.json
failures.json // only if some pages fail
```

## Why this exists

Target receipts can be nested behind order-detail pages, and some orders can contain multiple receipts. This extension is a small utility for people who need a local archive of their own receipts without clicking through every page manually.

## Privacy model

This project is intentionally local-only.

- No backend.
- No analytics.
- No telemetry.
- No ads.
- No external API calls.
- No credential collection.
- No Target login automation.
- No CAPTCHA bypass.
- No third-party JavaScript dependencies.
- Data is stored locally in your browser until you export or clear it.
- Exported receipt snapshots strip scripts, forms, event handlers, and remote media sources.

Temporary extension data is stored in IndexedDB because receipt HTML snapshots can be too large for regular extension storage.

## Install locally

1. Download or clone this repository.
2. Open Chrome.
3. Go to `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select this repository folder.
7. Pin the extension if you want easier access.

## Use

1. Log into Target manually in Chrome.
2. Open your Target order history / purchase history page.
3. Scroll or load the orders you want to export. The extension can only see links currently present in the page DOM.
4. Click the extension icon.
5. Click **Collect receipt links**.
6. Click **Download receipts**.
7. Keep Chrome open while it works.
8. Click **Export ZIP**.
9. After confirming the ZIP opens correctly, click **Clear data**.

## Important limitations

- This is not a Chrome Web Store package. It is meant to be loaded locally as an unpacked extension.
- It cannot access orders Target has not loaded into the current page.
- If Target lazy-loads older orders, scroll/load more orders and collect links again.
- Target can change its page structure at any time, which may require selector/ranking updates in `content.js`.
- The extension saves HTML snapshots, not PDFs. Chrome extensions cannot reliably bulk-print pages to PDF without user interaction.
- The parser makes best-effort guesses for order number, date, total, and status. The HTML snapshot is the source of truth.

## Permissions

| Permission | Why it is used |
|---|---|
| `activeTab` | Lets the extension inspect the Target tab when you click it. |
| `scripting` | Injects local scripts into Target pages to collect links and parse receipts. |
| `tabs` | Opens receipt pages one at a time in inactive tabs, then closes them. |
| `downloads` | Saves the exported ZIP to your computer. |
| `storage` | Required extension storage capability. |
| `unlimitedStorage` | Allows large local IndexedDB storage for receipt HTML snapshots. |
| `https://www.target.com/*`, `https://target.com/*` | Restricts host access to Target pages only. |

## Troubleshooting

### No links found

Try one of these:

- Make sure you are on `target.com` or `www.target.com`.
- Scroll further down your order history page so more orders load.
- Open an individual order page and click **Collect receipt links** there.
- Target may have changed its URL/link structure. Update the positive/negative patterns in `content.js`.

### Only one receipt saved for an order with multiple receipts

This version treats every collected order link as a parent and crawls the small nested tree underneath it. If it still misses a branch, inspect the page and adjust `DEEP_POSITIVE_PATTERNS` or `deepReceiptScore()` in `content.js`.

### Some pages failed

Export the ZIP anyway. Failed URLs are saved in `failures.json` so you can inspect or retry them later.

### Extension data gets large

Export your ZIP, confirm it opens correctly, then click **Clear data**.

## Project structure

```txt
manifest.json       Chrome Manifest V3 config
popup.html          Extension popup UI
popup.js            Popup behavior and ZIP export trigger
background.js       Crawler orchestration
content.js          Link collection and nested receipt discovery
receiptParser.js    Defensive page parser and HTML snapshot cleaner
db.js               IndexedDB wrapper
zipExporter.js      Dependency-free ZIP writer
styles.css          Popup styling
```

## Scope intentionally not included

- Budgeting.
- Categorization.
- AI classification.
- Amazon import.
- Bank import.
- Cloud sync.
- Google Sheets export.
- Automatic PDF generation.
- Chrome Web Store publishing flow.

## Development checklist

After changes:

```bash
for f in *.js; do node --check "$f"; done
python3 -m json.tool manifest.json >/dev/null
```

Then reload the unpacked extension at `chrome://extensions` and test on a small set of orders before running a larger export.

## License

MIT. See `LICENSE`.
