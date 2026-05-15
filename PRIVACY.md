# Privacy

Receipt Saver for Target is designed as a local-only browser utility.

## Data collected

The extension can collect, from Target pages you open:

- Target order / receipt page URLs.
- Visible page text.
- A cleaned HTML snapshot of receipt-like pages.
- Best-effort metadata guesses such as order number, order date, order total, status, and parser warnings.

## Data storage

Collected data is stored locally in your browser using IndexedDB. It remains there until you export it or click **Clear data**.

## Data sharing

The extension does not intentionally send collected data anywhere.

There is:

- No backend.
- No telemetry.
- No analytics.
- No ads.
- No external API calls.
- No third-party JavaScript dependency.

## Snapshot safety

Exported HTML snapshots remove scripts, forms, buttons, event handlers, dangerous JavaScript links, and remote media sources. Links may remain as plain links, but the exported snapshot should not execute Target page scripts.

## Credentials

The extension never asks for Target credentials. You log into Target directly in Chrome.
