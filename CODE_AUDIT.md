# Code audit notes

Date: 2026-05-14

This is a lightweight pre-publication audit, not a formal security review.

## Checked

- JavaScript syntax check passed for all `*.js` files.
- `manifest.json` parses as valid JSON.
- No `fetch()` calls found.
- No `XMLHttpRequest` usage found.
- No `navigator.sendBeacon()` usage found.
- No `eval()` usage found.
- No dynamic `Function()` usage found.
- No `chrome.cookies` permission or usage found.
- No `webRequest` permission or usage found.
- No remote script tags found.
- No third-party JavaScript dependency included.
- Host permissions are limited to `target.com` and `www.target.com`.

## Privacy-sensitive behavior

The extension reads visible Target pages that the user opens or that the extension opens from collected Target order links. It stores snapshots locally in IndexedDB and exports them to a local ZIP.

Exported HTML snapshots remove:

- Scripts.
- Forms.
- Buttons.
- Inputs.
- Event handler attributes.
- `javascript:` URLs.
- Remote media sources likely to auto-load when the snapshot is opened.

## Necessary permissions

- `activeTab`: inspect the active Target page when invoked.
- `scripting`: inject local collector/parser scripts.
- `tabs`: open receipt pages one at a time and close them.
- `downloads`: save the ZIP export.
- `storage`: extension storage capability.
- `unlimitedStorage`: large local IndexedDB snapshots.
- Target host permissions: restrict script access to Target pages.

## Remaining risks

- Target may change page structure, breaking link discovery or parser guesses.
- Users are responsible for reviewing applicable site terms before use.
- Receipt snapshots may contain personal information; users should not publish exported ZIPs or raw receipt examples.
- This project has not been reviewed for Chrome Web Store policy compliance.
