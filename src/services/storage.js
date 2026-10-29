/**
 * Local IndexedDB / LocalStorage service for persistent Assured Studio projects.
 * 100% client-side: no cloud dependencies, preserving complete data confidentiality.
 */

const DB_NAME = "AssuredStudioDB";
const STORE_NAME = "projects";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    let indexedDB;
    try { indexedDB = window.indexedDB; } catch { resolve(null); return; }
    if (!indexedDB) { resolve(null); return; }
    let request;
    try { request = indexedDB.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    let settled = false;
    request.onerror = () => { if (!settled) { settled = true; resolve(null); } };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Saved experiments are open in another tab. Close other Assured tabs and try again."));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onupgradeneeded = (e) => {
      if (settled) { request.transaction?.abort(); return; }
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

// A request succeeding does not mean its transaction committed. Only report
// success on completion, and release the connection on every failure path.
function transact(db, mode, operation, failureMessage) {
  return new Promise((resolve, reject) => {
    let tx, result, finished = false;
    const finish = error => {
      if (finished) return;
      finished = true;
      db.close();
      if (error) reject(new Error(`${failureMessage} ${error.message || ""}`.trim(), { cause: error }));
      else resolve(result);
    };
    try {
      tx = db.transaction(STORE_NAME, mode);
      tx.oncomplete = () => finish();
      tx.onerror = tx.onabort = () => finish(tx.error || new Error("Transaction interrupted."));
      operation(tx.objectStore(STORE_NAME), value => { result = value; });
    } catch (error) {
      try { tx?.abort(); } catch { /* The transaction may already be inactive. */ }
      finish(error);
    }
  });
}

function writeProjectsLocal(items) {
  try { localStorage.setItem("assured_projects", JSON.stringify(items)); }
  catch (cause) {
    throw new Error("Could not save browser storage. Export your experiment to keep a copy, then check available storage and browser permissions.", { cause });
  }
}

export async function saveProject(project) {
  if (!project || typeof project.id !== "string" || !project.id.trim()) {
    throw new Error("An experiment must have a valid ID before saving.");
  }
  const item = { ...project, updatedAt: new Date().toISOString() };
  const db = await openDB();
  if (db) {
    return transact(db, "readwrite", (store, setResult) => {
      store.put(item);
      setResult(item);
    }, "Saving was interrupted. Export your experiment and try again.");
  }
  const all = listProjectsLocal();
  const idx = all.findIndex(p => p.id === item.id);
  if (idx >= 0) all[idx] = item;
  else all.unshift(item);
  writeProjectsLocal(all);
  return item;
}

export async function getProject(id) {
  const db = await openDB();
  if (db) {
    return transact(db, "readonly", (store, setResult) => {
      const req = store.get(id);
      req.onsuccess = () => setResult(req.result || null);
    }, "Could not read the saved experiment. Try reopening Projects.");
  }
  return listProjectsLocal().find(p => p.id === id) || null;
}

export async function listProjects() {
  const db = await openDB();
  if (db) {
    const items = await transact(db, "readonly", (store, setResult) => {
      const req = store.getAll();
      req.onsuccess = () => setResult(req.result || []);
    }, "Could not read saved experiments. Try reopening Projects.");
    return items.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }
  return listProjectsLocal();
}

export async function deleteProject(id) {
  const db = await openDB();
  if (db) {
    return transact(db, "readwrite", (store, setResult) => {
      store.delete(id);
      setResult(true);
    }, "Deleting was interrupted. Try again.");
  }
  writeProjectsLocal(listProjectsLocal().filter(p => p.id !== id));
  return true;
}

function listProjectsLocal() {
  let raw;
  try { raw = localStorage.getItem("assured_projects"); }
  catch { throw new Error("Browser storage is unavailable. Export your experiment to keep a copy."); }
  if (raw === null) return [];
  let items;
  try { items = JSON.parse(raw); } catch { /* Report corruption without overwriting the stored data. */ }
  if (!Array.isArray(items) || items.some(p => !p || typeof p !== "object" || Array.isArray(p) || typeof p.id !== "string" || !p.id)) {
    throw new Error("Saved experiment data could not be read. Existing data has been preserved; export your current experiment before recovery.");
  }
  return items;
}

/**
 * Export project as a downloadable .assured bundle
 */
export function exportProjectBundle(project) {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(project.name || "experiment").toLowerCase().replace(/[^a-z0-9]/g, "_")}.assured`;
  a.click();
  URL.revokeObjectURL(url);
}
