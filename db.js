/* global indexedDB */
/*
  IndexedDB wrapper shared by the popup and service worker.
  We use IndexedDB, not chrome.storage.local, because receipt HTML snapshots can be large.
*/
const TargetReceiptDB = (() => {
  const DB_NAME = 'target_bulk_receipt_downloader';
  const DB_VERSION = 1;
  const STORES = ['links', 'receipts', 'failures', 'meta'];

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains('links')) {
          db.createObjectStore('links', { keyPath: 'url' });
        }
        if (!db.objectStoreNames.contains('receipts')) {
          db.createObjectStore('receipts', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('failures')) {
          db.createObjectStore('failures', { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return dbPromise;
  }

  async function transaction(storeName, mode, operation) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;

      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));

      result = operation(store);
    });
  }

  function requestToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function put(storeName, value) {
    return transaction(storeName, 'readwrite', (store) => store.put(value));
  }

  async function add(storeName, value) {
    return transaction(storeName, 'readwrite', (store) => store.add(value));
  }

  async function getAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async function count(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();
      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
  }

  async function clearStore(storeName) {
    return transaction(storeName, 'readwrite', (store) => store.clear());
  }

  async function clearAll() {
    await Promise.all(STORES.map((storeName) => clearStore(storeName)));
  }

  async function setLinks(links) {
    const now = new Date().toISOString();
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction('links', 'readwrite');
      const store = tx.objectStore('links');

      for (const link of links) {
        store.put({
          ...link,
          collected_at: link.collected_at || now,
          processed: Boolean(link.processed)
        });
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Link save transaction aborted'));
    });
  }

  async function setMeta(key, value) {
    return put('meta', { key, value, updated_at: new Date().toISOString() });
  }

  async function getMeta(key, fallback = null) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readonly');
      const store = tx.objectStore('meta');
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result ? request.result.value : fallback);
      request.onerror = () => reject(request.error);
    });
  }

  async function getStats() {
    const [linksCount, receiptsCount, failuresCount, status] = await Promise.all([
      count('links'),
      count('receipts'),
      count('failures'),
      getMeta('status', {
        state: 'idle',
        message: 'Ready.',
        currentIndex: 0,
        total: 0,
        updated_at: null
      })
    ]);

    return {
      linksCount,
      receiptsCount,
      failuresCount,
      status
    };
  }

  async function getAllData() {
    const [links, receipts, failures, stats] = await Promise.all([
      getAll('links'),
      getAll('receipts'),
      getAll('failures'),
      getStats()
    ]);

    return { links, receipts, failures, stats };
  }

  return {
    openDB,
    put,
    add,
    getAll,
    count,
    clearStore,
    clearAll,
    setLinks,
    setMeta,
    getMeta,
    getStats,
    getAllData,
    requestToPromise
  };
})();
