/*
  Collects plausible Target order / receipt links from the current page.
  There are two collectors:
  - collectLinks(): broad order/history collector used on the user's starting page.
  - collectDeepReceiptLinks(): stricter receipt/invoice collector used while crawling order pages.
*/
window.TargetReceiptContent = (() => {
  const TARGET_HOSTS = new Set(['target.com', 'www.target.com']);

  const BROAD_POSITIVE_PATTERNS = [
    /receipt/i,
    /invoice/i,
    /order/i,
    /order\s*details/i,
    /view\s*details/i,
    /purchase/i,
    /purchase\s*history/i,
    /orders?/i,
    /details/i
  ];

  const DEEP_POSITIVE_PATTERNS = [
    /receipt/i,
    /receipts?\s*(?:and|&)\s*invoices?/i,
    /invoice/i,
    /invoices?/i,
    /view\s*receipt/i,
    /view\s*invoice/i,
    /print\s*receipt/i,
    /order\s*receipt/i,
    /store\s*receipt/i,
    /digital\s*receipt/i,
    /payment\s*details/i,
    /transaction\s*details/i,
    /purchase\s*details/i,
    /receipt\s*details/i,
    /view\s*(?:all\s*)?receipts/i,
    /receipts/i,
    /invoices/i
  ];

  const BROAD_NEGATIVE_PATTERNS = [
    /privacy/i,
    /terms/i,
    /accessibility/i,
    /weekly-ad/i,
    /circle/i,
    /redcard/i,
    /cart/i,
    /checkout/i,
    /signin/i,
    /login/i,
    /registry/i,
    /gift/i,
    /product\//i,
    /\/p\//i,
    /\/c\//i,
    /\/s\?/i,
    /search/i,
    /store-locator/i
  ];

  const DEEP_NEGATIVE_PATTERNS = [
    /privacy/i,
    /terms/i,
    /accessibility/i,
    /weekly-ad/i,
    /circle/i,
    /redcard/i,
    /cart/i,
    /checkout/i,
    /signin/i,
    /login/i,
    /registry/i,
    /gift/i,
    /product\//i,
    /\/p\//i,
    /\/c\//i,
    /\/s\?/i,
    /search/i,
    /store-locator/i,
    /return-policy/i,
    /tracking/i,
    /track/i,
    /reorder/i,
    /buy-again/i,
    /write-review/i,
    /reviews?/i,
    /cancel/i,
    /help/i,
    /contact/i,
    /chat/i
  ];

  function normalizeUrl(rawHref) {
    if (!rawHref) return null;

    try {
      const url = new URL(rawHref, window.location.href);
      url.hash = '';

      if (!TARGET_HOSTS.has(url.hostname)) return null;
      if (!['http:', 'https:'].includes(url.protocol)) return null;

      return url.toString();
    } catch (_error) {
      return null;
    }
  }

  function elementLabel(element) {
    const pieces = [];
    const text = (element.innerText || element.textContent || '').trim();
    const aria = element.getAttribute('aria-label') || '';
    const title = element.getAttribute('title') || '';
    const dataTest = element.getAttribute('data-test') || element.getAttribute('data-testid') || '';
    pieces.push(text, aria, title, dataTest);
    return pieces.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function textAroundLink(anchor, maxParentText = 1200) {
    const pieces = [elementLabel(anchor)];

    const parent = anchor.closest('section, article, li, div, main');
    if (parent) pieces.push((parent.innerText || parent.textContent || '').slice(0, maxParentText));

    return pieces.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  }

  function getCandidateElements() {
    return Array.from(document.querySelectorAll('a[href], area[href]'));
  }

  function isBroadCandidate(url, label) {
    const combined = `${url} ${label}`;
    const positive = BROAD_POSITIVE_PATTERNS.some((pattern) => pattern.test(combined));
    const negative = BROAD_NEGATIVE_PATTERNS.some((pattern) => pattern.test(combined));

    let urlLooksOrderish = false;
    try {
      const parsed = new URL(url);
      urlLooksOrderish = /account|orders?|order-details|purchase|receipt|invoice/i.test(parsed.pathname + parsed.search);
    } catch (_error) {
      urlLooksOrderish = false;
    }

    return (positive || urlLooksOrderish) && !negative;
  }

  function deepReceiptScore(url, label) {
    const combined = `${url} ${label}`.replace(/\s+/g, ' ');
    const lower = combined.toLowerCase();
    let score = 0;

    if (/receipt/i.test(combined)) score += 100;
    if (/invoice/i.test(combined)) score += 90;
    if (/receipts?\s*(?:and|&)\s*invoices?/i.test(combined)) score += 120;
    if (/view\s*(?:your\s*)?(?:receipt|invoice)/i.test(combined)) score += 60;
    if (/print\s*(?:receipt|invoice)/i.test(combined)) score += 50;
    if (/order\s*(?:receipt|invoice)/i.test(combined)) score += 40;
    if (/purchase\s*details/i.test(combined)) score += 25;
    if (/receipt\s*details/i.test(combined)) score += 70;
    if (/view\s*(?:all\s*)?receipts/i.test(combined)) score += 90;
    if (/receipts/i.test(combined)) score += 65;
    if (/invoices/i.test(combined)) score += 55;
    if (/payment\s*details/i.test(combined)) score += 20;
    if (/transaction\s*details/i.test(combined)) score += 20;

    try {
      const parsed = new URL(url);
      const pathAndSearch = `${parsed.pathname} ${parsed.search}`;
      if (/receipt/i.test(pathAndSearch)) score += 160;
      if (/invoice/i.test(pathAndSearch)) score += 140;
      if (/order-details|orderdetails/i.test(pathAndSearch)) score += 20;
      if (/orders?/i.test(pathAndSearch)) score += 8;
      if (/account/i.test(pathAndSearch)) score += 5;
    } catch (_error) {
      // ignore
    }

    if (/reorder|buy\s*again|write\s*a?\s*review|review|tracking|track\s*package|return|cancel|help|contact/i.test(lower)) score -= 120;
    if (DEEP_NEGATIVE_PATTERNS.some((pattern) => pattern.test(combined))) score -= 80;

    return score;
  }

  function collectLinks() {
    const warnings = [];
    const sourcePageUrl = window.location.href;
    const byUrl = new Map();

    for (const anchor of getCandidateElements()) {
      const url = normalizeUrl(anchor.getAttribute('href'));
      if (!url) continue;

      const label = textAroundLink(anchor);
      if (!isBroadCandidate(url, label)) continue;

      if (!byUrl.has(url)) {
        byUrl.set(url, {
          url,
          label: label.slice(0, 500),
          source_page_url: sourcePageUrl
        });
      }
    }

    const links = Array.from(byUrl.values());

    if (links.length === 0) {
      warnings.push('No plausible order/receipt links found on this page. Scroll your Target order history to load more orders, or open an order detail page and try again.');
    }

    if (!/target\.com/i.test(window.location.hostname)) {
      warnings.push('This does not look like a Target page.');
    }

    return {
      ok: true,
      pageUrl: sourcePageUrl,
      links,
      warnings
    };
  }

  function collectDeepReceiptLinks() {
    const warnings = [];
    const sourcePageUrl = window.location.href;
    const currentUrl = normalizeUrl(sourcePageUrl);
    const byUrl = new Map();

    for (const anchor of getCandidateElements()) {
      const url = normalizeUrl(anchor.getAttribute('href'));
      if (!url || url === currentUrl) continue;

      const label = textAroundLink(anchor, 600);
      const score = deepReceiptScore(url, label);
      if (score < 50) continue;

      const existing = byUrl.get(url);
      if (!existing || score > existing.score) {
        byUrl.set(url, {
          url,
          label: label.slice(0, 500),
          source_page_url: sourcePageUrl,
          score,
          reason: score >= 100 ? 'strong receipt/invoice match' : 'possible deeper receipt link'
        });
      }
    }

    const links = Array.from(byUrl.values()).sort((a, b) => b.score - a.score);

    if (links.length === 0) {
      warnings.push('No deeper receipt/invoice links found on this page. This page may be snapshotted as a receipt leaf.');
    }

    return {
      ok: true,
      pageUrl: sourcePageUrl,
      links,
      warnings
    };
  }

  return { collectLinks, collectDeepReceiptLinks, deepReceiptScore };
})();
