/* idb-helper.js — shared IndexedDB access for BugReel extension */

const IDB_NAME = 'bugreel-blobs';
const IDB_STORE = 'recordings';
const IDB_KEY = 'pending-recording';

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveRecordingBlob(blob, metadata) {
  // Chrome: store the Blob directly. Converting to ArrayBuffer doubles peak
  // memory (offscreen doc OOMs on >1 GB recordings) and Chrome's structured
  // clone handles Blobs in IDB just fine.
  // Firefox: extension contexts lose Blob data across tabs, so we fall back
  // to ArrayBuffer there — pay the memory cost to keep the data alive.
  const isFirefox = typeof browser !== 'undefined' && !!browser.runtime;
  const mimeType = blob.type || 'video/webm';

  const payload = isFirefox
    ? { arrayBuffer: await blob.arrayBuffer(), mimeType, ...metadata }
    : { blob, mimeType, ...metadata };

  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(payload, IDB_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function loadRecordingBlob() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = () => {
      db.close();
      const data = req.result;
      if (!data) { resolve(null); return; }

      // Reconstruct Blob from stored ArrayBuffer (Firefox path).
      // Chrome path stores the Blob directly — just keep it.
      if (data.arrayBuffer && !data.blob) {
        data.blob = new Blob([data.arrayBuffer], { type: data.mimeType || 'video/webm' });
        delete data.arrayBuffer;
      }
      delete data.mimeType;
      resolve(data);
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function deleteRecordingBlob() {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(IDB_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
