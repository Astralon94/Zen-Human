// ============ Persistenza robusta (offline-first) ============
// Fonte di verità in memoria: `data`. Due copie durevoli: localStorage + IndexedDB.
// Anti-overwrite: ogni save incrementa `rev` (monotòno). Al boot si adotta SEMPRE la
// copia con `rev` più alto (savedAt come spareggio). Niente euristiche "a conteggio record".
// Backup/trasferimento via export/import JSON. Vault opzionale su cartella (Chrome).

import { DEFAULT_DATA, migrate, DATA_VERSION } from './model.js';
import { todayStr, pad2 } from '../domain/util.js';

const LS_KEY = 'zen-human.data.v1';
const IDB_NAME = 'zen-human-db';
const IDB_STORE = 'kv';
const MAIN = 'zen-human.json';
const KEEP_BACKUPS = 20, KEEP_SNAPSHOTS = 30;

export let data = DEFAULT_DATA();
const listeners = new Set();
let idbTimer = null;
let lsFull = false;

// Istanti (session-level) dell'ultimo snapshot e dell'ultimo backup scritti sul vault.
// Sono fatti derivati dagli eventi di scrittura, non vengono persistiti nel modello.
let lastSnapshotAt = 0, lastBackupAt = 0;
const metaListeners = new Set();
export function subscribeMeta(fn) { metaListeners.add(fn); return () => metaListeners.delete(fn); }
function emitMeta() { metaListeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }
export const vaultMeta = () => ({ lastSnapshotAt, lastBackupAt });

// ---- Vault su cartella (Chrome/Chromium: File System Access API) ----
let vaultDir = null, vaultOn = false, vaultNeedsPerm = false, vaultTimer = null;
export const fileSupported = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); }

// ---- IndexedDB ----
function idbOpen() {
  return new Promise(res => {
    if (typeof indexedDB === 'undefined') return res(null);
    try {
      const rq = indexedDB.open(IDB_NAME, 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore(IDB_STORE);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}
async function idbPut(obj) {
  const db = await idbOpen(); if (!db) return;
  try { db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(JSON.stringify(obj), 'data'); } catch (e) {}
}
function idbGet() {
  return idbOpen().then(db => {
    if (!db) return null;
    return new Promise(res => {
      try {
        const rq = db.transaction(IDB_STORE).objectStore(IDB_STORE).get('data');
        rq.onsuccess = () => { try { res(JSON.parse(rq.result) || null); } catch (e) { res(null); } };
        rq.onerror = () => res(null);
      } catch (e) { res(null); }
    });
  });
}
async function idbSetRaw(key, val) { const db = await idbOpen(); if (!db) return; try { db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(val, key); } catch (e) {} }
function idbGetRaw(key) {
  return idbOpen().then(db => { if (!db) return null; return new Promise(res => { try { const rq = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key); rq.onsuccess = () => res(rq.result ?? null); rq.onerror = () => res(null); } catch (e) { res(null); } }); });
}

// ---- Vault su cartella (File System Access) ----
async function ensurePerm(handle, request) {
  if (!handle?.queryPermission) return true;
  const opts = { mode: 'readwrite' };
  let p = await handle.queryPermission(opts);
  if (p === 'granted') return true;
  if (request) p = await handle.requestPermission(opts);
  return p === 'granted';
}
const ts = () => { const d = new Date(); return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`; };

async function dirReadJson(dir, name) { const fh = await dir.getFileHandle(name); const f = await fh.getFile(); return JSON.parse(await f.text()); }
async function dirWriteText(dir, name, text) { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(text); await w.close(); }
async function listJson(dir) { const out = []; try { for await (const [n, h] of dir.entries()) if (h.kind === 'file' && n.endsWith('.json')) out.push(n); } catch (e) {} return out.sort(); }
async function pruneDir(dir, keep) { const files = await listJson(dir); for (let i = 0; i < files.length - keep; i++) { try { await dir.removeEntry(files[i]); } catch (e) {} } }

// scrive l'intero vault: backup del principale, principale, snapshot del giorno
async function writeVault(dir, d) {
  const backups = await dir.getDirectoryHandle('backups', { create: true });
  const snaps = await dir.getDirectoryHandle('snapshots', { create: true });
  const full = JSON.stringify(d, null, 2);
  try { const cur = await dirReadJson(dir, MAIN); await dirWriteText(backups, `zen-human-${ts()}.json`, JSON.stringify(cur)); await pruneDir(backups, KEEP_BACKUPS); lastBackupAt = Date.now(); emitMeta(); } catch (e) {}
  await dirWriteText(dir, MAIN, full);
  try { await dirWriteText(snaps, `zen-human-${todayStr()}.json`, full); await pruneDir(snaps, KEEP_SNAPSHOTS); lastSnapshotAt = Date.now(); emitMeta(); } catch (e) {}
}

// Inizializza gli istanti di snapshot/backup dai file già presenti sul disco (sessioni precedenti).
async function readVaultMeta(dir) {
  for (const [sub, apply] of [['backups', v => { lastBackupAt = v; }], ['snapshots', v => { lastSnapshotAt = v; }]]) {
    try {
      const h = await dir.getDirectoryHandle(sub);
      let m = 0;
      for (const f of await listJson(h)) { try { const file = await (await h.getFileHandle(f)).getFile(); if (file.lastModified > m) m = file.lastModified; } catch (e) {} }
      if (m) apply(m);
    } catch (e) {}
  }
  emitMeta();
}

async function readVault(dir) {
  let obj = null;
  try { const o = await dirReadJson(dir, MAIN); if (Array.isArray(o.companies)) obj = o; } catch (e) {}
  if (!obj) { // auto-recupero da backup/snapshot
    for (const sub of ['backups', 'snapshots']) {
      try { const h = await dir.getDirectoryHandle(sub); const files = (await listJson(h)).reverse(); for (const f of files) { try { const o = JSON.parse(await (await (await h.getFileHandle(f)).getFile()).text()); if (Array.isArray(o.companies)) { obj = o; break; } } catch (e) {} } } catch (e) {}
      if (obj) break;
    }
  }
  return obj;
}

// ---- Save / persistenza ----
export function save({ silent = false } = {}) {
  data.rev = (data.rev || 0) + 1;
  data.savedAt = Date.now();
  data.version = DATA_VERSION;
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); lsFull = false; }
  catch (e) { if (!lsFull) { lsFull = true; console.warn('localStorage pieno: solo IndexedDB/vault'); } }
  clearTimeout(idbTimer);
  idbTimer = setTimeout(() => idbPut(data), 300);
  if (vaultOn && vaultDir) { clearTimeout(vaultTimer); vaultTimer = setTimeout(() => writeVault(vaultDir, data).catch(() => {}), 400); }
  if (!silent) emit();
}

export function flush() {
  try { idbPut(data); } catch (e) {}
  if (vaultOn && vaultDir) { try { writeVault(vaultDir, data); } catch (e) {} }
}

export function setData(newData, { persist = true } = {}) {
  data = migrate(newData);
  if (persist) save({ silent: true });
  emit();
}

function pickFresher(a, b) {
  if (!a) return b; if (!b) return a;
  const ra = a.rev || 0, rb = b.rev || 0;
  if (ra !== rb) return ra > rb ? a : b;
  return (a.savedAt || 0) >= (b.savedAt || 0) ? a : b;
}

// ---- Boot ----
export async function boot() {
  let ls = null;
  try { ls = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) {}
  if (ls && Array.isArray(ls.companies)) data = migrate(ls);
  else data = DEFAULT_DATA();
  emit();

  const idb = await idbGet();
  if (idb && Array.isArray(idb.companies)) {
    const winner = pickFresher(data, idb);
    if (winner !== data) {
      data = migrate(winner);
      try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
      emit();
    } else if ((idb.rev || 0) < (data.rev || 0)) idbPut(data);
  } else {
    idbPut(data);
  }

  if (fileSupported()) {
    try {
      vaultDir = await idbGetRaw('vaultDir');
      if (vaultDir) {
        if (await ensurePerm(vaultDir, false)) {
          vaultOn = true;
          readVaultMeta(vaultDir).catch(() => {});
          const vd = await readVault(vaultDir);
          if (vd && Array.isArray(vd.companies)) {
            const winner = pickFresher(data, vd);
            if (winner === vd) {
              data = migrate(vd);
              try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
              idbPut(data);
            } else if ((data.rev || 0) > (vd.rev || 0)) {
              writeVault(vaultDir, data).catch(() => {});
            }
            emit();
          }
        } else {
          vaultNeedsPerm = true;
        }
      }
    } catch (e) {}
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);
  try { if (navigator.storage?.persist) navigator.storage.persisted().then(p => { if (!p) navigator.storage.persist().catch(() => {}); }); } catch (e) {}
}

// ---- Gestione vault su cartella (per la UI Impostazioni, solo Chrome) ----
export const vaultStatus = () => ({ supported: fileSupported(), active: vaultOn, needsPerm: vaultNeedsPerm, name: vaultDir?.name || null });

export async function connectVault() {
  if (!fileSupported()) return { ok: false };
  let dir;
  try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); }
  catch (e) { return { ok: false, canceled: true }; }
  if (!(await ensurePerm(dir, true))) return { ok: false };
  vaultDir = dir; vaultOn = true; vaultNeedsPerm = false;
  await idbSetRaw('vaultDir', dir);
  readVaultMeta(dir).catch(() => {});
  const vd = await readVault(dir);
  if (vd && Array.isArray(vd.companies)) {
    const winner = pickFresher(data, vd);
    if (winner === vd) { data = migrate(vd); try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {} idbPut(data); }
    else { await writeVault(dir, data); }
  } else {
    try { await writeVault(dir, data); } catch (e) { return { ok: false, error: e.message }; }
  }
  emit();
  return { ok: true, name: dir.name };
}

export async function reauthorizeVault() {
  if (!vaultDir) return { ok: false };
  if (!(await ensurePerm(vaultDir, true))) return { ok: false };
  vaultNeedsPerm = false; vaultOn = true;
  readVaultMeta(vaultDir).catch(() => {});
  const vd = await readVault(vaultDir);
  if (vd && Array.isArray(vd.companies)) {
    const winner = pickFresher(data, vd);
    if (winner === vd) { data = migrate(vd); try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {} idbPut(data); }
    else if ((data.rev || 0) > (vd.rev || 0)) await writeVault(vaultDir, data);
  }
  emit();
  return { ok: true };
}

export async function disconnectVault() {
  vaultDir = null; vaultOn = false; vaultNeedsPerm = false;
  await idbSetRaw('vaultDir', null);
  emit();
}

// ---- Ripristino da backup/snapshot del vault ----
export async function listRestorePoints() {
  if (!vaultDir) return [];
  const out = [];
  for (const [sub, type] of [['backups', 'backup'], ['snapshots', 'snapshot']]) {
    try { const h = await vaultDir.getDirectoryHandle(sub); for (const f of (await listJson(h))) { try { const file = await (await h.getFileHandle(f)).getFile(); out.push({ type, file: f, mtime: file.lastModified, size: file.size }); } catch (e) {} } } catch (e) {}
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}
export async function restorePoint(type, file) {
  if (!vaultDir) return { ok: false };
  try {
    const h = await vaultDir.getDirectoryHandle(type === 'snapshot' ? 'snapshots' : 'backups');
    const obj = JSON.parse(await (await (await h.getFileHandle(file)).getFile()).text());
    if (!Array.isArray(obj.companies)) return { ok: false };
    obj.rev = Math.max(obj.rev || 0, data.rev || 0) + 1;
    data = migrate(obj);
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
    idbPut(data);
    await writeVault(vaultDir, data);
    emit();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}
