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
  // Convert Blob → ArrayBuffer for storage.
  // Firefox extension contexts can lose Blob data in IDB across tabs;
  // ArrayBuffer is reliably stored via structured clone.
  const arrayBuffer = await blob.arrayBuffer();
  const mimeType = blob.type || 'video/webm';

  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ arrayBuffer, mimeType, ...metadata }, IDB_KEY);
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

      // Reconstruct Blob from stored ArrayBuffer
      if (data.arrayBuffer) {
        data.blob = new Blob([data.arrayBuffer], { type: data.mimeType || 'video/webm' });
        delete data.arrayBuffer;
        delete data.mimeType;
      }
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
