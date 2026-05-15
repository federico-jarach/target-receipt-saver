# Security

## Supported use

This project is meant for personal/local use by the account holder. It does not automate login, bypass CAPTCHA, hide automation, or access accounts that do not belong to the user.

## Reporting security issues

If you publish this on GitHub and want to accept reports, enable GitHub private vulnerability reporting or add a contact email here.

Please do not include real receipts, order numbers, payment details, or personal data in public issues.

## Security posture

The project intentionally avoids:

- Remote code loading.
- Third-party scripts.
- External API calls.
- Credential handling.
- Broad host permissions.
- Background crawling outside user-triggered actions.

Known tradeoff: the extension needs `tabs`, `scripting`, `downloads`, and Target host permissions to open receipt pages, inject local scripts, and export the ZIP.
