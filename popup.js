/* global chrome, TargetReceiptDB, TargetZipExporter */
const TARGET_RE = /^https:\/\/(www\.)?target\.com\//i;

const els = {
  pageStatus: document.getElementById('pageStatus'),
  collectBtn: document.getElementById('collectBtn'),
  crawlBtn: document.getElementById('crawlBtn'),
  exportBtn: document.getElementById('exportBtn'),
  clearBtn: document.getElementById('clearBtn'),
  linksCount: document.getElementById('linksCount'),
  receiptsCount: document.getElementById('receiptsCount'),
  failuresCount: document.getElementById('failuresCount'),
  statusMessage: document.getElementById('statusMessage'),
  progress: document.getElementById('progress'),
  warningsBox: document.getElementById('warningsBox'),
  warningsList: document.getElementById('warningsList')
};

let activeTab = null;
let polling = null;

function chromeCallback(fn) {
  return new Promise((resolve, reject) => {
    fn((result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

async function getActiveTab() {
  const tabs = await chromeCallback((done) => chrome.tabs.query({ active: true, currentWindow: true }, done));
  return tabs && tabs[0] ? tabs[0] : null;
}

function sendMessage(message) {
  return chromeCallback((done) => chrome.runtime.sendMessage(message, done));
}

function setWarnings(warnings) {
  const list = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
  els.warningsList.innerHTML = '';

  if (!list.length) {
    els.warningsBox.classList.add('hidden');
    return;
  }

  for (const warning of list) {
    const li = document.createElement('li');
    li.textContent = warning;
    els.warningsList.appendChild(li);
  }

  els.warningsBox.classList.remove('hidden');
}

function setBusy(isBusy) {
  els.collectBtn.disabled = isBusy || !isTargetPage();
  els.crawlBtn.disabled = isBusy;
  els.exportBtn.disabled = isBusy;
  els.clearBtn.disabled = isBusy;
}

function isTargetPage() {
  return Boolean(activeTab && activeTab.url && TARGET_RE.test(activeTab.url));
}

async function refreshStats() {
  const response = await sendMessage({ type: 'getStats' }).catch((error) => ({ ok: false, error: error.message }));
  if (!response || response.ok === false) {
    els.statusMessage.textContent = response && response.error ? response.error : 'Could not read status.';
    return;
  }

  els.linksCount.textContent = response.linksCount || 0;
  els.receiptsCount.textContent = response.receiptsCount || 0;
  els.failuresCount.textContent = response.failuresCount || 0;

  const status = response.status || {};
  els.statusMessage.textContent = status.message || 'Ready.';

  const total = Number(status.total || 0);
  const current = Number(status.currentIndex || 0);
  els.progress.max = total > 0 ? total : 1;
  els.progress.value = total > 0 ? Math.min(current, total) : 0;

  const isCrawling = status.state === 'crawling';
  setBusy(isCrawling);

  if (!isTargetPage()) {
    els.collectBtn.disabled = true;
  }
}

async function init() {
  activeTab = await getActiveTab();

  if (isTargetPage()) {
    els.pageStatus.textContent = 'Target page detected.';
  } else {
    els.pageStatus.textContent = 'Open Target order history first.';
    els.collectBtn.disabled = true;
  }

  els.collectBtn.addEventListener('click', onCollectLinks);
  els.crawlBtn.addEventListener('click', onCrawlReceipts);
  els.exportBtn.addEventListener('click', onExportZip);
  els.clearBtn.addEventListener('click', onClearData);

  await refreshStats();
  polling = setInterval(refreshStats, 1200);
}

async function onCollectLinks() {
  setWarnings([]);
  setBusy(true);
  els.statusMessage.textContent = 'Collecting visible receipt links...';

  const response = await sendMessage({ type: 'collectLinks', tabId: activeTab.id }).catch((error) => ({ ok: false, error: error.message }));
  if (!response.ok) {
    els.statusMessage.textContent = response.error || 'Could not collect links.';
  } else {
    els.statusMessage.textContent = `Collected ${response.count || 0} link${response.count === 1 ? '' : 's'}.`;
    setWarnings(response.warnings || []);
  }

  await refreshStats();
}

async function onCrawlReceipts() {
  setWarnings([]);
  setBusy(true);
  els.statusMessage.textContent = 'Starting receipt download... Keep Chrome open.';

  const response = await sendMessage({ type: 'crawlReceipts' }).catch((error) => ({ ok: false, error: error.message }));
  if (!response.ok) {
    els.statusMessage.textContent = response.error || 'Could not download receipts.';
  } else {
    els.statusMessage.textContent = `Done. Downloaded ${response.successCount}; failed ${response.failureCount}.`;
  }

  await refreshStats();
}

async function onExportZip() {
  setWarnings([]);
  setBusy(true);
  els.statusMessage.textContent = 'Building ZIP...';

  try {
    const data = await TargetReceiptDB.getAllData();
    if (!data.receipts || data.receipts.length === 0) {
      els.statusMessage.textContent = 'No downloaded receipts yet.';
      return;
    }

    const blob = TargetZipExporter.buildExport(data);
    const url = URL.createObjectURL(blob);
    const filename = TargetZipExporter.exportFilename();

    await chromeCallback((done) => chrome.downloads.download({ url, filename, saveAs: true }, done));
    els.statusMessage.textContent = `Exported ${filename}.`;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    els.statusMessage.textContent = error && error.message ? error.message : String(error);
  } finally {
    await refreshStats();
  }
}

async function onClearData() {
  setWarnings([]);
  setBusy(true);
  els.statusMessage.textContent = 'Clearing local data...';

  const response = await sendMessage({ type: 'clearData' }).catch((error) => ({ ok: false, error: error.message }));
  if (!response.ok) {
    els.statusMessage.textContent = response.error || 'Could not clear data.';
  }

  await refreshStats();
}

window.addEventListener('unload', () => {
  if (polling) clearInterval(polling);
});

init().catch((error) => {
  els.pageStatus.textContent = 'Extension init failed.';
  els.statusMessage.textContent = error && error.message ? error.message : String(error);
});
