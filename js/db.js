// Tanek ovoj okoli IndexedDB. Vsi podatki živijo v brskalniku na tej napravi.

const DB_NAME = 'stroski';
const DB_VERSION = 3;
const STORES = { transactions: 'id', categories: 'id', rules: 'id', recurring: 'id', work: 'id', settings: 'id', meta: 'key' };

let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => {
      // Ko se v drugem zavihku naloži novejša verzija, sprosti bazo in se osveži.
      req.result.onversionchange = () => { req.result.close(); location.reload(); };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
    // Starejša verzija aplikacije je odprta v drugem zavihku in drži bazo.
    req.onblocked = () => {
      document.getElementById('view').innerHTML = '<div class="card">Aplikacija se posodablja. Zapri druge zavihke ali okna aplikacije Stroški, nato osveži to stran.</div>';
    };
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const getAll = store => run(store, 'readonly', s => s.getAll());
export const put = (store, value) => run(store, 'readwrite', s => { s.put(value); });
export const putMany = (store, values) => run(store, 'readwrite', s => { for (const v of values) s.put(v); });
export const removeMany = (store, keys) => run(store, 'readwrite', s => { for (const k of keys) s.delete(k); });
export const clear = store => run(store, 'readwrite', s => { s.clear(); });
