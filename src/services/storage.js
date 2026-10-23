/**
 * Local IndexedDB / LocalStorage service for persistent Assured Studio projects.
 * 100% client-side: no cloud dependencies, preserving complete data confidentiality.
 */

const DB_NAME = "AssuredStudioDB";
const STORE_NAME = "projects";
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      resolve(null); // Fallback to localStorage
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => resolve(null);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

export async function saveProject(project) {
  const item = {
    ...project,
    updatedAt: new Date().toISOString()
  };

  const db = await openDB();
  if (db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(item);
      tx.oncomplete = () => resolve(item);
      tx.onerror = () => reject(tx.error);
    });
  } else {
    // LocalStorage fallback
    const all = listProjectsLocal();
    const idx = all.findIndex(p => p.id === item.id);
    if (idx >= 0) all[idx] = item;
    else all.unshift(item);
    localStorage.setItem("assured_projects", JSON.stringify(all));
    return item;
  }
}

export async function getProject(id) {
  const db = await openDB();
  if (db) {
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } else {
    const all = listProjectsLocal();
    return all.find(p => p.id === id) || null;
  }
}

export async function listProjects() {
  const db = await openDB();
  if (db) {
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const sorted = (req.result || []).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        resolve(sorted);
      };
      req.onerror = () => resolve([]);
    });
  } else {
    return listProjectsLocal();
  }
}

export async function deleteProject(id) {
  const db = await openDB();
  if (db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  } else {
    let all = listProjectsLocal().filter(p => p.id !== id);
    localStorage.setItem("assured_projects", JSON.stringify(all));
    return true;
  }
}

function listProjectsLocal() {
  try {
    const raw = localStorage.getItem("assured_projects");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
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
