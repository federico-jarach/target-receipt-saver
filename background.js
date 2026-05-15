/* global chrome, TargetReceiptDB */
importScripts('db.js');

const TARGET_RE = /^https:\/\/(www\.)?target\.com\//i;
const DEFAULT_DELAY_MS = 1200;
const PAGE_SETTLE_MS = 1100;
const MAX_TREE_DEPTH = 5;
const MAX_PAGES_PER_PARENT_ORDER = 30;
let crawlRunning = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chromeCallback(fn) {
  return new Promise((resolve, reject) => {
    fn((result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

async function getTab(tabId) {
  return chromeCallback((done) => chrome.tabs.get(tabId, done));
}

async function createTab(options) {
  return chromeCallback((done) => chrome.tabs.create(options, done));
}

async function removeTab(tabId) {
  return chromeCallback((done) => chrome.tabs.remove(tabId, done));
}

async function updateTab(tabId, options) {
  return chromeCallback((done) => chrome.tabs.update(tabId, options, done));
}

async function executeScript(options) {
  try {
    return await chrome.scripting.executeScript(options);
  } catch (error) {
    throw new Error(error && error.message ? error.message : String(error));
  }
}

function normalizeUrlKey(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    return url.toString();
  } catch (_error) {
    return String(rawUrl || '');
  }
}

function hashString(value) {
  const text = String(value || '');
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash) + text.charCodeAt(i);
    hash >>>= 0;
  }
  return hash.toString(36);
}

function safeSlug(value, fallback = 'receipt') {
  const safe = String(value || fallback)
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
  return safe || fallback;
}

function makeReceiptId(receipt, parentIndex, branchIndex) {
  const url = receipt.final_receipt_url || receipt.source_url || '';
  const base = receipt.order_number_guess || url || `receipt-${parentIndex}-${branchIndex}`;
  return `${String(parentIndex + 1).padStart(4, '0')}-${String(branchIndex + 1).padStart(3, '0')}-${safeSlug(base)}-${hashString(url).slice(0, 8)}`;
}

async function updateStatus(status) {
  const next = {
    state: status.state || 'idle',
    message: status.message || '',
    currentIndex: status.currentIndex || 0,
    total: status.total || 0,
    updated_at: new Date().toISOString()
  };
  await TargetReceiptDB.setMeta('status', next);
  return next;
}

async function waitForTabComplete(tabId, timeoutMs = 45000) {
  const tab = await getTab(tabId).catch(() => null);
  if (tab && tab.status === 'complete') return;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Timed out waiting for tab ${tabId} to load.`));
    }, timeoutMs);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function collectLinks(tabId) {
  const tab = await getTab(tabId);
  if (!tab || !tab.url || !TARGET_RE.test(tab.url)) {
    await updateStatus({ state: 'idle', message: 'Open Target order history first.' });
    return { ok: false, error: 'Active tab is not a Target page.' };
  }

  await executeScript({ target: { tabId }, files: ['content.js'] });
  const results = await executeScript({
    target: { tabId },
    func: () => window.TargetReceiptContent.collectLinks()
  });

  const payload = results && results[0] && results[0].result ? results[0].result : { links: [], warnings: ['No result returned from content script.'] };
  const links = Array.isArray(payload.links) ? payload.links : [];

  await TargetReceiptDB.setLinks(links);
  await updateStatus({
    state: 'idle',
    message: `Collected ${links.length} link${links.length === 1 ? '' : 's'}.`,
    currentIndex: 0,
    total: links.length
  });

  return {
    ok: true,
    count: links.length,
    warnings: payload.warnings || [],
    links
  };
}

async function collectDeepReceiptLinks(tabId) {
  await executeScript({ target: { tabId }, files: ['content.js'] });
  const results = await executeScript({
    target: { tabId },
    func: () => window.TargetReceiptContent.collectDeepReceiptLinks()
  });

  return results && results[0] && results[0].result
    ? results[0].result
    : { links: [], warnings: ['No result returned while looking for deeper receipt links.'] };
}

async function navigateTabTo(tabId, url) {
  await updateTab(tabId, { url });
  await waitForTabComplete(tabId);
  await sleep(PAGE_SETTLE_MS);
}

async function parseCurrentPage(tabId) {
  await executeScript({ target: { tabId }, files: ['receiptParser.js'] });
  const results = await executeScript({
    target: { tabId },
    func: () => window.TargetReceiptParser.parseReceiptPage()
  });

  const receipt = results && results[0] && results[0].result ? results[0].result : null;
  if (!receipt) throw new Error('No receipt data returned from parser.');
  return receipt;
}

function pageLooksLikeActualReceipt(receipt, currentUrl) {
  const text = String(receipt.visible_text || '').toLowerCase();
  const url = String(currentUrl || receipt.source_url || '').toLowerCase();
  const hasReceiptWord = /receipt|invoice/.test(url) || /receipt|invoice/.test(text);
  const hasMoney = /\$\s*\d+[,.]?\d*\.\d{2}/.test(text);
  const hasReceiptContext = /subtotal|tax|total|payment|paid|card|transaction|qty|quantity|item|return window|order number|receipt number/.test(text);

  return Boolean(hasReceiptWord && (hasMoney || receipt.order_total_guess) && hasReceiptContext);
}

function receiptCandidateLinks(deepLinks, visitedKeys, queuedKeys) {
  const byUrl = new Map();

  for (const link of Array.isArray(deepLinks) ? deepLinks : []) {
    if (!link || !link.url) continue;
    const key = normalizeUrlKey(link.url);
    if (!key || visitedKeys.has(key) || queuedKeys.has(key)) continue;

    const existing = byUrl.get(key);
    if (!existing || Number(link.score || 0) > Number(existing.score || 0)) {
      byUrl.set(key, { ...link, url: key });
    }
  }

  return Array.from(byUrl.values()).sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
}

async function saveReceiptRecord({ receipt, parentLink, parentIndex, branchIndex, currentUrl, resolutionPath, extraWarnings }) {
  receipt.parent_order_index = parentIndex + 1;
  receipt.receipt_branch_index = branchIndex + 1;
  receipt.id = makeReceiptId({ ...receipt, final_receipt_url: currentUrl }, parentIndex, branchIndex);
  receipt.link_label = parentLink.label || '';
  receipt.collected_from = parentLink.source_page_url || '';
  receipt.initial_order_url = parentLink.url;
  receipt.final_receipt_url = currentUrl || receipt.source_url || '';
  receipt.resolution_path = resolutionPath || [];
  receipt.saved_at = new Date().toISOString();

  const warnings = Array.isArray(receipt.parser_warnings) ? receipt.parser_warnings : [];
  const mergedWarnings = Array.from(new Set([...warnings, ...(extraWarnings || [])]));
  receipt.parser_warnings = mergedWarnings;

  await TargetReceiptDB.put('receipts', receipt);
  return receipt;
}

async function crawlReceiptTreeForParent(tab, parentLink, parentIndex, totalParents) {
  const visitedKeys = new Set();
  const queuedKeys = new Set();
  const savedReceiptKeys = new Set();
  const queue = [{
    url: null,
    depth: 0,
    path: [{ action: 'open-parent-order', url: parentLink.url, label: parentLink.label || '' }]
  }];

  let branchIndex = 0;
  let successCount = 0;
  let failureCount = 0;
  let inspectedPages = 0;

  while (queue.length > 0 && inspectedPages < MAX_PAGES_PER_PARENT_ORDER) {
    const node = queue.shift();

    try {
      if (node.url) {
        await updateStatus({
          state: 'crawling',
          message: `Opening nested receipt ${parentIndex + 1} of ${totalParents} (${branchIndex + 1} saved so far)...`,
          currentIndex: parentIndex + 1,
          total: totalParents
        });
        await navigateTabTo(tab.id, node.url);
      }

      const currentTab = await getTab(tab.id).catch(() => null);
      const currentUrl = normalizeUrlKey(currentTab && currentTab.url ? currentTab.url : parentLink.url);
      if (!currentUrl || visitedKeys.has(currentUrl)) continue;

      visitedKeys.add(currentUrl);
      inspectedPages += 1;

      await updateStatus({
        state: 'crawling',
        message: `Inspecting Target page ${parentIndex + 1} of ${totalParents} (${inspectedPages} page${inspectedPages === 1 ? '' : 's'} under this order)...`,
        currentIndex: parentIndex + 1,
        total: totalParents
      });

      const deep = await collectDeepReceiptLinks(tab.id).catch((error) => ({
        links: [],
        warnings: [`Deep-link scan failed: ${error && error.message ? error.message : String(error)}`]
      }));

      const deepWarnings = Array.isArray(deep.warnings) ? deep.warnings : [];
      const candidates = node.depth + 1 < MAX_TREE_DEPTH
        ? receiptCandidateLinks(deep.links, visitedKeys, queuedKeys)
        : [];

      let receipt = null;
      let parseError = null;
      try {
        receipt = await parseCurrentPage(tab.id);
      } catch (error) {
        parseError = error;
      }

      const isLeaf = candidates.length === 0;
      const looksLikeReceipt = receipt ? pageLooksLikeActualReceipt(receipt, currentUrl) : false;
      const shouldSaveCurrentPage = Boolean(
        receipt && (
          isLeaf ||
          (looksLikeReceipt && candidates.length <= 1) ||
          (node.depth === 0 && isLeaf)
        )
      );

      if (shouldSaveCurrentPage && !savedReceiptKeys.has(currentUrl)) {
        const resolutionPath = [
          ...(node.path || []),
          { action: 'snapshot-current-page', url: currentUrl, depth: node.depth, reason: isLeaf ? 'leaf receipt/order page' : 'receipt-like page' }
        ];

        await saveReceiptRecord({
          receipt,
          parentLink,
          parentIndex,
          branchIndex,
          currentUrl,
          resolutionPath,
          extraWarnings: deepWarnings
        });

        savedReceiptKeys.add(currentUrl);
        branchIndex += 1;
        successCount += 1;
      } else if (parseError && isLeaf) {
        throw parseError;
      }

      for (const candidate of candidates) {
        if (queue.length + visitedKeys.size >= MAX_PAGES_PER_PARENT_ORDER) break;
        const candidateKey = normalizeUrlKey(candidate.url);
        queuedKeys.add(candidateKey);
        queue.push({
          url: candidate.url,
          depth: node.depth + 1,
          path: [
            ...(node.path || []),
            {
              action: 'navigate-deeper',
              from: currentUrl,
              to: candidate.url,
              label: candidate.label || '',
              score: candidate.score || '',
              depth: node.depth
            }
          ]
        });
      }
    } catch (error) {
      failureCount += 1;
      await TargetReceiptDB.add('failures', {
        url: node.url || parentLink.url,
        parent_order_url: parentLink.url,
        label: parentLink.label || '',
        source_page_url: parentLink.source_page_url || '',
        error: error && error.message ? error.message : String(error),
        failed_at: new Date().toISOString(),
        parent_index: parentIndex,
        branch_index: branchIndex,
        path: node.path || []
      });
    }

    await sleep(350);
  }

  if (queue.length > 0) {
    await TargetReceiptDB.add('failures', {
      url: parentLink.url,
      parent_order_url: parentLink.url,
      label: parentLink.label || '',
      source_page_url: parentLink.source_page_url || '',
      error: `Stopped after inspecting ${MAX_PAGES_PER_PARENT_ORDER} pages under one parent order. Remaining nested links were skipped to avoid runaway crawling.`,
      failed_at: new Date().toISOString(),
      parent_index: parentIndex
    });
    failureCount += 1;
  }

  if (successCount === 0 && failureCount === 0) {
    await TargetReceiptDB.add('failures', {
      url: parentLink.url,
      parent_order_url: parentLink.url,
      label: parentLink.label || '',
      source_page_url: parentLink.source_page_url || '',
      error: 'No receipt pages were saved under this parent order.',
      failed_at: new Date().toISOString(),
      parent_index: parentIndex
    });
    failureCount += 1;
  }

  return { successCount, failureCount, inspectedPages };
}

async function parseOneParentOrder(link, index, total) {
  let tab = null;

  try {
    await updateStatus({
      state: 'crawling',
      message: `Opening order ${index + 1} of ${total}...`,
      currentIndex: index + 1,
      total
    });

    tab = await createTab({ url: link.url, active: false });
    await waitForTabComplete(tab.id);
    await sleep(1000);

    return await crawlReceiptTreeForParent(tab, link, index, total);
  } catch (error) {
    const failure = {
      url: link.url,
      label: link.label || '',
      source_page_url: link.source_page_url || '',
      error: error && error.message ? error.message : String(error),
      failed_at: new Date().toISOString(),
      parent_index: index
    };
    await TargetReceiptDB.add('failures', failure);
    return { successCount: 0, failureCount: 1, inspectedPages: 0 };
  } finally {
    if (tab && tab.id) {
      await removeTab(tab.id).catch(() => {});
    }
  }
}

async function crawlReceipts() {
  if (crawlRunning) {
    return { ok: false, error: 'Download already running.' };
  }

  crawlRunning = true;

  try {
    const links = await TargetReceiptDB.getAll('links');
    const total = links.length;

    if (!total) {
      await updateStatus({ state: 'idle', message: 'No links collected yet.', currentIndex: 0, total: 0 });
      return { ok: false, error: 'No collected links. Click “Collect receipt links” first.' };
    }

    await updateStatus({ state: 'crawling', message: `Starting crawl across ${total} parent order link${total === 1 ? '' : 's'}...`, currentIndex: 0, total });

    let successCount = 0;
    let failureCount = 0;
    let inspectedPages = 0;

    for (let index = 0; index < links.length; index += 1) {
      const result = await parseOneParentOrder(links[index], index, total);
      successCount += result.successCount || 0;
      failureCount += result.failureCount || 0;
      inspectedPages += result.inspectedPages || 0;
      await sleep(DEFAULT_DELAY_MS);
    }

    await updateStatus({
      state: 'idle',
      message: `Done. Saved ${successCount} receipt page${successCount === 1 ? '' : 's'} from ${total} parent link${total === 1 ? '' : 's'}; failed ${failureCount}.`,
      currentIndex: total,
      total
    });

    return { ok: true, successCount, failureCount, inspectedPages, total };
  } finally {
    crawlRunning = false;
  }
}

async function handleMessage(message) {
  switch (message && message.type) {
    case 'getStats':
      return { ok: true, ...(await TargetReceiptDB.getStats()) };
    case 'collectLinks':
      return collectLinks(message.tabId);
    case 'crawlReceipts':
      return crawlReceipts();
    case 'clearData':
      await TargetReceiptDB.clearAll();
      await updateStatus({ state: 'idle', message: 'Cleared local data.', currentIndex: 0, total: 0 });
      return { ok: true };
    default:
      return { ok: false, error: 'Unknown message type.' };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ ok: false, error: error && error.message ? error.message : String(error) }));

  return true;
});
