/*
  Defensive Target receipt/order page parser.
  The core value is preserving the visible text + clean HTML snapshot even when guesses fail.
*/
window.TargetReceiptParser = (() => {
  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeWhitespace(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function getVisibleText() {
    if (!document.body) return '';
    return normalizeWhitespace(document.body.innerText || document.body.textContent || '');
  }

  function removeRiskyElements(root) {
    const selectors = [
      'script',
      'noscript',
      'iframe',
      'object',
      'embed',
      'canvas',
      'video',
      'audio',
      'form',
      'button',
      'input',
      'select',
      'textarea'
    ];

    root.querySelectorAll(selectors.join(',')).forEach((node) => node.remove());

    root.querySelectorAll('*').forEach((node) => {
      for (const attr of Array.from(node.attributes || [])) {
        const name = attr.name.toLowerCase();
        const value = attr.value || '';
        if (name.startsWith('on')) node.removeAttribute(attr.name);
        if (name === 'srcset') node.removeAttribute(attr.name);
        if (name === 'style' && /url\s*\(/i.test(value)) node.removeAttribute(attr.name);

        // Keep exported snapshots passive. Scripts are already removed above, but
        // remote image/media URLs can still cause network requests when the local
        // snapshot is opened later. Remove them so exported files stay local-only.
        if ((name === 'src' || name === 'poster') && /^(https?:)?\/\//i.test(value)) {
          node.removeAttribute(attr.name);
          node.setAttribute('data-removed-remote-src', 'true');
        }

        if ((name === 'src' || name === 'href') && /^javascript:/i.test(value)) {
          node.removeAttribute(attr.name);
        }
      }
    });
  }

  function getCleanHtmlSnapshot(metadata = {}) {
    const bodyClone = document.body ? document.body.cloneNode(true) : document.createElement('body');
    removeRiskyElements(bodyClone);

    const safe = (value) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Target Receipt Snapshot</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 24px; line-height: 1.45; color: #1f2937; }
    .snapshot-header { border: 1px solid #d1d5db; border-radius: 12px; padding: 16px; margin-bottom: 24px; background: #f9fafb; }
    .snapshot-header h1 { font-size: 20px; margin: 0 0 12px; }
    .snapshot-meta { font-size: 13px; color: #374151; }
    img { max-width: 220px; height: auto; }
    a { color: #1d4ed8; }
  </style>
</head>
<body>
  <div class="snapshot-header">
    <h1>Target Receipt Snapshot</h1>
    <div class="snapshot-meta"><strong>Source URL:</strong> ${safe(metadata.source_url)}</div>
    <div class="snapshot-meta"><strong>Extracted at:</strong> ${safe(metadata.extracted_at)}</div>
    <div class="snapshot-meta"><strong>Order number guess:</strong> ${safe(metadata.order_number_guess)}</div>
    <div class="snapshot-meta"><strong>Date guess:</strong> ${safe(metadata.order_date_guess)}</div>
    <div class="snapshot-meta"><strong>Total guess:</strong> ${safe(metadata.order_total_guess)}</div>
    <div class="snapshot-meta"><strong>Status guess:</strong> ${safe(metadata.status_guess)}</div>
  </div>
  ${bodyClone.innerHTML}
</body>
</html>`;
  }

  function guessOrderNumber(text) {
    const patterns = [
      /order\s*(?:number|#|no\.?|id)?\s*[:#]?\s*([A-Z0-9-]{6,})/i,
      /receipt\s*(?:number|#|no\.?)?\s*[:#]?\s*([A-Z0-9-]{6,})/i,
      /(?:^|\s)#\s*([A-Z0-9-]{6,})/i
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return match[1].replace(/[^A-Z0-9-]/gi, '').trim();
    }

    return '';
  }

  function guessOrderDate(text) {
    const monthName = /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)/i;
    const patterns = [
      new RegExp(`(?:ordered|order date|placed|purchased|delivered|picked up)[^A-Za-z0-9]{0,30}(${monthName.source}\\s+\\d{1,2},?\\s+\\d{4})`, 'i'),
      new RegExp(`(${monthName.source}\\s+\\d{1,2},?\\s+\\d{4})`, 'i'),
      /(?:ordered|order date|placed|purchased|delivered|picked up)[^0-9]{0,30}(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
      /(\d{1,2}\/\d{1,2}\/\d{2,4})/
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) return normalizeWhitespace(match[1]);
    }

    return '';
  }

  function moneyMatches(text) {
    return Array.from(text.matchAll(/\$\s*([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\.([0-9]{2})/g))
      .map((match) => ({ raw: match[0].replace(/\s+/g, ''), value: Number(`${match[1].replace(/,/g, '')}.${match[2]}`), index: match.index || 0 }));
  }

  function guessOrderTotal(text) {
    const focusedPatterns = [
      /(?:order\s*total|grand\s*total|total)\D{0,80}(\$\s*[0-9,]+\.\d{2})/i,
      /(\$\s*[0-9,]+\.\d{2})\D{0,40}(?:order\s*total|grand\s*total|total)/i
    ];

    for (const pattern of focusedPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) return match[1].replace(/\s+/g, '');
    }

    const amounts = moneyMatches(text).filter((item) => item.value > 0);
    if (!amounts.length) return '';

    // A receipt page often repeats item prices, subtotal, tax, and total. Highest amount is a reasonable fallback.
    amounts.sort((a, b) => b.value - a.value);
    return amounts[0].raw;
  }

  function guessStatus(text) {
    const statuses = [
      'Delivered',
      'Shipped',
      'Picked up',
      'Ready for pickup',
      'Processing',
      'Canceled',
      'Cancelled',
      'Returned',
      'Refunded'
    ];

    const lower = text.toLowerCase();
    const found = statuses.find((status) => lower.includes(status.toLowerCase()));
    return found || '';
  }

  function estimateItemCount(text) {
    const amountCount = moneyMatches(text).length;
    const qtyMatches = Array.from(text.matchAll(/\bqty\.?\s*[:#]?\s*(\d+)\b/gi));
    const explicitQty = qtyMatches.reduce((sum, match) => sum + Number(match[1] || 0), 0);

    if (explicitQty > 0) return explicitQty;
    if (amountCount > 0) return Math.max(1, Math.min(amountCount - 2, 200));
    return '';
  }

  function parseReceiptPage() {
    const extractedAt = nowIso();
    const sourceUrl = window.location.href;
    const visibleText = getVisibleText();
    const parserWarnings = [];

    const orderNumberGuess = guessOrderNumber(visibleText);
    const orderDateGuess = guessOrderDate(visibleText);
    const orderTotalGuess = guessOrderTotal(visibleText);
    const statusGuess = guessStatus(visibleText);
    const itemCountEstimate = estimateItemCount(visibleText);

    if (!visibleText) parserWarnings.push('No visible text extracted. The page may not have loaded or may be protected.');
    if (!orderNumberGuess) parserWarnings.push('Could not guess order number.');
    if (!orderDateGuess) parserWarnings.push('Could not guess order date.');
    if (!orderTotalGuess) parserWarnings.push('Could not guess order total.');

    const metadata = {
      source_url: sourceUrl,
      extracted_at: extractedAt,
      order_number_guess: orderNumberGuess,
      order_date_guess: orderDateGuess,
      order_total_guess: orderTotalGuess,
      status_guess: statusGuess
    };

    return {
      source: 'target',
      extracted_at: extractedAt,
      source_url: sourceUrl,
      page_title: document.title || '',
      order_number_guess: orderNumberGuess,
      order_date_guess: orderDateGuess,
      order_total_guess: orderTotalGuess,
      status_guess: statusGuess,
      item_count_estimate: itemCountEstimate,
      visible_text: visibleText,
      clean_html_snapshot: getCleanHtmlSnapshot(metadata),
      parser_warnings: parserWarnings
    };
  }

  return {
    getVisibleText,
    getCleanHtmlSnapshot,
    guessOrderNumber,
    guessOrderDate,
    guessOrderTotal,
    guessStatus,
    estimateItemCount,
    parseReceiptPage
  };
})();
