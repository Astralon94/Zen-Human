// ============ Autenticazione — hashing password (scrypt) + sessioni PERSISTENTI ============
// Nessuna dipendenza esterna (solo node:crypto + node:fs). Derivato dal modello di Zen-Store.
import { scryptSync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA_DIR, DB_PATH } from './db.js';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const calc = scryptSync(String(password), salt, 64);
  const known = Buffer.from(hash, 'hex');
  return calc.length === known.length && timingSafeEqual(calc, known);
}

// ---- Sessioni: token -> { userId, creata, lastSeen, ...campi futuri } ----
// Sono PERSISTITE su disco in `<data>/sessions.json`, così sopravvivono a riavvii e
// aggiornamenti del server (la cartella data/ non è versionata e l'updater non la tocca).
// Scadenza SCORREVOLE: una sessione resta valida finché viene usata almeno una volta
// ogni 30 giorni; ogni accesso ne rinnova `lastSeen`. Vale sia per l'app locale sia in
// produzione (server persistente dietro Cloudflare Tunnel).
const sessions = new Map();
const IDLE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 giorni di inattività
// Per non riscrivere il file a ogni richiesta, il rinnovo di `lastSeen` si persiste solo
// quando avanza di più di questa soglia. Creazioni e distruzioni si scrivono sempre subito.
const SAVE_THROTTLE_MS = 1000 * 60 * 5; // 5 minuti

// Percorso del file sessioni: accanto al DB (stessa logica di db.js — condivide DATA_DIR/DB_PATH,
// così i test con ZEN_DB in /tmp scrivono lì e :memory: resta solo in RAM).
const SESSIONS_PATH = DB_PATH === ':memory:' ? null : join(dirname(DB_PATH) || DATA_DIR, 'sessions.json');

// Scrittura ATOMICA (file temporaneo + rename) dell'intera mappa, ripulita dalle scadute.
function persist() {
  if (!SESSIONS_PATH) return;
  const now = Date.now();
  const out = {};
  for (const [t, s] of sessions) {
    if (now - s.lastSeen > IDLE_TTL_MS) { sessions.delete(t); continue; }
    out[t] = s; // spread implicito: eventuali campi futuri vengono preservati
  }
  try {
    mkdirSync(dirname(SESSIONS_PATH), { recursive: true });
    const tmp = `${SESSIONS_PATH}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, sessions: out }));
    renameSync(tmp, SESSIONS_PATH);
  } catch { /* disco non scrivibile: le sessioni restano comunque valide in memoria */ }
}

// Caricamento all'avvio: file mancante/corrotto → si parte vuoti, senza errori.
// Le sessioni già scadute vengono scartate e il file ripulito.
function load() {
  if (!SESSIONS_PATH || !existsSync(SESSIONS_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(SESSIONS_PATH, 'utf8'));
    const map = raw && typeof raw.sessions === 'object' && raw.sessions ? raw.sessions : {};
    const now = Date.now();
    let changed = false;
    for (const [t, s] of Object.entries(map)) {
      if (!s || typeof s.userId === 'undefined') { changed = true; continue; }
      // Tolleranza: se manca lastSeen (formato più vecchio) ripiega su creata, poi su now.
      const lastSeen = typeof s.lastSeen === 'number' ? s.lastSeen : (typeof s.creata === 'number' ? s.creata : now);
      if (now - lastSeen > IDLE_TTL_MS) { changed = true; continue; }
      sessions.set(t, { ...s, lastSeen });
    }
    if (changed) persist(); // pulizia all'avvio delle sessioni scadute/invalide
  } catch { /* file corrotto → mappa vuota */ }
}
load();

export function createSession(userId) {
  const token = randomUUID();
  const now = Date.now();
  sessions.set(token, { userId, creata: now, lastSeen: now });
  persist();
  return token;
}

export function getSession(token) {
  const s = sessions.get(token);
  if (!s) return null;
  const now = Date.now();
  if (now - s.lastSeen > IDLE_TTL_MS) { sessions.delete(token); persist(); return null; }
  // Rinnovo scorrevole: aggiorna lastSeen, ma persiste solo oltre la soglia di throttle.
  if (now - s.lastSeen > SAVE_THROTTLE_MS) { s.lastSeen = now; persist(); }
  return s;
}

export function destroySession(token) { if (sessions.delete(token)) persist(); }
export function destroySessionsOfUser(userId) {
  let removed = false;
  for (const [t, s] of sessions) if (s.userId === userId) { sessions.delete(t); removed = true; }
  if (removed) persist();
}
