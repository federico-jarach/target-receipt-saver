# GitHub publishing notes

## Recommended repository name

`target-receipt-saver`

## Short description

Unofficial local-only Chrome extension for saving your own Target order receipts as HTML snapshots in a ZIP.

## Topics

```txt
chrome-extension
manifest-v3
receipt-export
personal-finance
local-first
privacy
indexeddb
target
```

## Suggested first release title

`v0.3.1 — local-only multi-receipt Target receipt saver`

## Suggested release notes

Initial public release.

- Local-only Chrome Manifest V3 extension.
- Collects visible Target order links from order history pages.
- Crawls nested receipt/invoice links under each parent order.
- Supports multiple receipts under one order.
- Exports HTML snapshots, raw JSON metadata, `manifest.csv`, and `manifest.json` as a ZIP.
- No backend, telemetry, analytics, external API calls, or credential handling.

## Suggested pinned disclaimer

This is an unofficial personal utility. It is not affiliated with Target. Use it only for your own account data and review applicable website terms before use.
