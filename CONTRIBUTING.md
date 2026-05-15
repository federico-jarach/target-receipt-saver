# Contributing

Contributions are welcome if they keep the project small, local-only, and privacy-preserving.

## Good contributions

- Better Target receipt-link detection.
- Safer HTML snapshot cleanup.
- Better parser guesses for order number, date, total, and status.
- Clearer troubleshooting docs.
- Bug fixes that reduce missed receipts or duplicate exports.

## Out of scope

- Credential collection.
- Login automation.
- CAPTCHA bypass.
- Hidden/background scraping.
- Analytics or telemetry.
- Hosted backend features.
- Third-party tracking scripts.

## Before opening a PR

Run:

```bash
for f in *.js; do node --check "$f"; done
python3 -m json.tool manifest.json >/dev/null
```

Then reload the unpacked extension in Chrome and test on a small order-history sample.
