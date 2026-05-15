# Changelog

## 0.3.1

- Renamed public-facing extension to **Receipt Saver for Target**.
- Added open-source repo materials: README, MIT license, privacy, security, contributing docs.
- Strengthened snapshot cleanup by removing remote media sources from exported HTML snapshots.
- Clarified unofficial/local-only privacy posture.

## 0.3.0

- Added support for multiple receipt pages under the same parent order.
- Added parent/branch indexing in receipt metadata and ZIP manifest.
- Switched nested receipt traversal from single-link resolution to bounded tree crawling.

## 0.2.0

- Added deeper navigation from order detail pages into nested receipt/invoice links.

## 0.1.0

- Initial local Chrome extension.
- Collect visible Target order/receipt links.
- Open links one at a time.
- Save HTML snapshots and raw JSON.
- Export ZIP.
