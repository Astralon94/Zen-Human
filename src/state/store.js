// ============ Persistenza via server locale (node:sqlite) ============
// Fonte di verità durevole: il DB del server. In memoria: `data`.
//  - boot()  → GET  /api/data     (carica lo stato dal DB)
//  - save()  → POST /api/changes  (GRANULARE: invia solo i record cambiati dall'ultimo save)
//  - setData/importJSON → PUT /api/data (sostituzione totale, con backup forzato)
// Il frontend continua a mutare `data` e chiamare save(); il diff lo calcola questo modulo.

import { DEFAULT_DATA, migrate, DATA_VERSION } from './model.js';

export let data = DEFAULT_DATA();

// Collezioni versionate (stesso ordine del modello).
const COLLECTION_KEYS = ['companies', 'employees', 'attendance', 'entries'];

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }

// Compat col vecchio badge snapshot/backup del vault: nel modello server non serve più.
const metaListeners = new Set();
export function subscribeMeta(fn) { metaListeners.add(fn); return () => metaListeners.delete(fn); }
export const vaultMeta = () => ({ lastSnapshotAt: lastSavedAt, lastBackupAt: 0 });

let lastSavedAt = null;
let saveTimer = null;
let inflight = false;
let snapshot = null;

// ---- Stato del salvataggio (spia AFFIDABILE: riflette l'esito reale lato server) ----
// 'saved' = tutto confermato · 'saving' = modifica non ancora confermata · 'error' = ultima scrittura fallita
let dirty = false, errored = false;
const statusListeners = new Set();
export function onSaveStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); }
export function saveStatus() { return errored ? 'error' : (inflight || dirty) ? 'saving' : 'saved'; }
function notifyStatus() { const s = saveStatus(); statusListeners.forEach(fn => { try { fn(s); } catch (e) { console.error(e); } }); }

// ---- Snapshot & diff -------------------------------------------------------
function snapOf(d) {
  const s = {};
  for (const k of COLLECTION_KEYS) {
    const m = new Map();
    for (const rec of (d[k] || [])) if (rec && rec.id != null) m.set(rec.id, JSON.stringify(rec));
    s[k] = m;
  }
  s.__settings = JSON.stringify(d.settings || {});
  return s;
}
function diff(prev, d) {
  const collections = {};
  let any = false;
  for (const k of COLLECTION_KEYS) {
    const pm = prev[k] || new Map();
    const upsert = [], remove = [], seen = new Set();
    for (const rec of (d[k] || [])) {
      if (!rec || rec.id == null) continue;
      seen.add(rec.id);
      if (pm.get(rec.id) !== JSON.stringify(rec)) upsert.push(rec);
    }
    for (const id of pm.keys()) if (!seen.has(id)) remove.push(id);
    if (upsert.length || remove.length) { collections[k] = { upsert, remove }; any = true; }
  }
  const out = { collections };
  if (JSON.stringify(d.settings || {}) !== prev.__settings) { out.settings = d.settings || {}; any = true; }
  return any ? out : null;
}

// ---- Boot ----
export async function boot() {
  try {
    const res = await fetch('/api/data');
    data = res.ok ? migrate(await res.json()) : DEFAULT_DATA();
  } catch (e) { console.error('Boot: server non raggiungibile', e); data = DEFAULT_DATA(); }
  snapshot = snapOf(data);
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  }
  emit();
}

// ---- Save: invia solo il diff (debounced) ----
export function save({ silent = false } = {}) {
  data.savedAt = Date.now();
  data.version = DATA_VERSION;
  dirty = true; notifyStatus();          // c'è qualcosa di non ancora confermato dal server
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushChanges, 300);
  if (!silent) emit();
}

async function flushChanges() {
  if (!snapshot) return;
  if (inflight) { clearTimeout(saveTimer); saveTimer = setTimeout(flushChanges, 200); return; }
  const cs = diff(snapshot, data);
  if (!cs) { dirty = false; errored = false; notifyStatus(); return; } // niente da inviare = già in sync
  const sent = snapOf(data);
  inflight = true; dirty = false; notifyStatus();
  try {
    const res = await fetch('/api/changes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cs) });
    if (res.ok) { const j = await res.json(); if (j && j.rev) data.rev = j.rev; snapshot = sent; lastSavedAt = Date.now(); errored = false; }
    else { errored = true; dirty = true; console.error('Salvataggio non riuscito:', res.status); } // NON confermato → resta da salvare
  } catch (e) { errored = true; dirty = true; console.error('Errore di salvataggio:', e); }
  finally {
    inflight = false; notifyStatus();
    if (dirty) { clearTimeout(saveTimer); saveTimer = setTimeout(flushChanges, errored ? 3000 : 250); } // riprova
  }
}

// Sostituzione TOTALE (import/wipe): PUT dell'intero stato + backup forzato lato server.
async function putWhole({ force = false } = {}) {
  inflight = true; notifyStatus();
  try {
    const res = await fetch('/api/data' + (force ? '?force=1' : ''), {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    if (res.ok) { const j = await res.json(); if (j && j.rev) data.rev = j.rev; lastSavedAt = Date.now(); dirty = false; errored = false; }
    else { errored = true; console.error('Salvataggio totale non riuscito:', res.status); }
  } catch (e) { errored = true; console.error('Errore salvataggio totale:', e); }
  finally { inflight = false; notifyStatus(); }
}

export function setData(newData, { persist = true } = {}) {
  data = migrate(newData);
  snapshot = snapOf(data);
  if (persist) putWhole({ force: true });
  emit();
}

export function flush() {
  if (!snapshot) return;
  const cs = diff(snapshot, data);
  if (!cs) return;
  try {
    fetch('/api/changes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cs), keepalive: true });
  } catch (e) {}
}

// ---- Export / Import JSON (backup manuale) ----
export function exportJSON() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date().toISOString().slice(0, 10);
  a.href = url; a.download = `zen-human-backup-${d}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function importJSON(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = async () => {
      try {
        const d = JSON.parse(r.result);
        if (!Array.isArray(d.companies)) throw new Error('Struttura non valida');
        data = migrate(d);
        snapshot = snapOf(data);
        await putWhole({ force: true });
        emit();
        resolve(data);
      } catch (e) { reject(e); }
    };
    r.onerror = () => reject(new Error('Lettura file fallita'));
    r.readAsText(file);
  });
}

// ---- Compat "vault"/FSA: nel modello server lo store durevole è il DB ----
export const fileSupported = () => false;
export const vaultStatus = () => ({ supported: true, active: true, needsPerm: false, name: 'server' });
export async function connectVault() { return { ok: true }; }
export async function reauthorizeVault() { return { ok: true }; }
export async function disconnectVault() { return { ok: false }; }
export async function listRestorePoints() { return []; }
export async function restorePoint() { return { ok: false }; }
