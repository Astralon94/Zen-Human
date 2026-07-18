// =============================================================================
//  ZEN-HUMAN · CATALOGO PERMESSI — UNICA FONTE DI VERITÀ
// -----------------------------------------------------------------------------
//  Registro centrale di TUTTI i permessi e delle voci di navigazione dell'app.
//  Usato dal backend (guardie API) e servito al frontend (gating menu + schermata
//  permessi utente). Quando si aggiunge una funzione all'app si aggiorna QUI:
//    1) il/i permesso/i in PERMISSIONS
//    2) la voce in NAV (se ha una schermata)
//    3) la guardia nell'endpoint in server.js
//
//  Modello (Livello A): autenticazione + gating UI FINE (permesso per singola
//  azione) + guardia di scrittura GROSSOLANA sul backend (un solo endpoint dati).
//  Nessun filtraggio del dataset per utente: tutti gli autenticati caricano lo
//  stato intero (app locale su un Mac).
//
//  Granularità (decomposizione entità × azione): ogni entità ha una `.view` per
//  AREA di nav e permessi distinti per crea / modifica / elimina (+ azioni di
//  dominio: esporta, importa, reset, aggiorna). I permessi di scrittura portano
//  `write:true` e alimentano DATA_MANAGE (guardia grossolana su /api/changes).
//
//  Regole d'oro:
//   - Gli utenti con ruolo 'admin' hanno SEMPRE tutti i permessi.
//   - I permessi con adminOnly:true valgono solo per gli admin (non assegnabili).
//   - I permessi standard sono "particellari": assegnabili singolarmente.
// =============================================================================

export const RUOLI = { admin: 'Amministratore', standard: 'Operatore' };

// Catalogo permessi (particellari). `group` raggruppa nella UI; `write:true`
// marca le scritture sulle collezioni (crea/modifica/elimina).
export const PERMISSIONS = [
  // ---- Riepiloghi ----
  { key: 'riepilogo.view',      group: 'Riepiloghi',     label: 'Vedere il riepilogo mensile' },
  { key: 'riepilogo.esporta',   group: 'Riepiloghi',     label: 'Esportare i prospetti (PDF consulente, PDF interno, CSV)' },
  { key: 'scadenze.view',       group: 'Riepiloghi',     label: 'Vedere le scadenze (contratti, libretti)' },

  // ---- Presenze ----
  { key: 'presenze.view',       group: 'Presenze',       label: 'Consultare le presenze' },
  { key: 'presenze.crea',       group: 'Presenze',       label: 'Compilare le presenze (pennello e nuove giornate)', write: true },
  { key: 'presenze.modifica',   group: 'Presenze',       label: 'Modificare le giornate già registrate', write: true },
  { key: 'presenze.elimina',    group: 'Presenze',       label: 'Svuotare le giornate di presenza', write: true },
  { key: 'mese.chiusura',       group: 'Presenze',       label: 'Chiudere e riaprire i mesi (blocca le modifiche)', write: true },

  // ---- Turni (pianificazione) — le scritture riusano i permessi presenze.* ----
  { key: 'turni.view',          group: 'Turni',          label: 'Vedere la griglia di pianificazione dei turni' },

  // ---- Retribuzioni (voci economiche) ----
  { key: 'voci.view',           group: 'Retribuzioni',   label: 'Consultare le voci economiche (bonus, sanzioni, acconti)' },
  { key: 'voci.crea',           group: 'Retribuzioni',   label: 'Aggiungere voci economiche (bonus, sanzioni, acconti)', write: true },
  { key: 'voci.modifica',       group: 'Retribuzioni',   label: 'Modificare le voci economiche', write: true },
  { key: 'voci.elimina',        group: 'Retribuzioni',   label: 'Eliminare le voci economiche', write: true },

  // ---- Anagrafiche (dipendenti, prestiti, stipendi, aziende) ----
  { key: 'dipendenti.view',     group: 'Anagrafiche',    label: 'Consultare dipendenti, prestiti e stipendi' },
  { key: 'dipendenti.crea',     group: 'Anagrafiche',    label: 'Aggiungere dipendenti', write: true },
  { key: 'dipendenti.modifica', group: 'Anagrafiche',    label: 'Modificare i dipendenti', write: true },
  { key: 'dipendenti.elimina',  group: 'Anagrafiche',    label: 'Eliminare i dipendenti', write: true },
  { key: 'prestiti.crea',       group: 'Anagrafiche',    label: 'Creare prestiti rateizzati', write: true },
  { key: 'prestiti.modifica',   group: 'Anagrafiche',    label: 'Gestire le rate dei prestiti', write: true },
  { key: 'prestiti.elimina',    group: 'Anagrafiche',    label: 'Eliminare i prestiti', write: true },
  { key: 'stipendi.crea',       group: 'Anagrafiche',    label: 'Impostare lo stipendio pattuito', write: true },
  { key: 'stipendi.elimina',    group: 'Anagrafiche',    label: 'Eliminare voci dello storico stipendio', write: true },
  { key: 'aziende.crea',        group: 'Anagrafiche',    label: 'Creare aziende', write: true },
  { key: 'aziende.modifica',    group: 'Anagrafiche',    label: 'Modificare le aziende', write: true },
  { key: 'aziende.elimina',     group: 'Anagrafiche',    label: 'Eliminare le aziende', write: true },

  // ---- Configurazione (nessuno è di scrittura sulle collezioni) ----
  { key: 'impostazioni.manage', group: 'Configurazione', label: 'Gestire le impostazioni (aspetto)' },
  { key: 'software.aggiorna',   group: 'Configurazione', label: 'Controllare e installare gli aggiornamenti software' },
  { key: 'dati.export',         group: 'Configurazione', label: 'Esportare il backup JSON' },
  { key: 'dati.import',         group: 'Configurazione', label: 'Importare/sostituire i dati (operazione totale)' },
  { key: 'dati.reset',          group: 'Configurazione', label: 'Azzerare tutti i dati' },
  { key: 'utenti.manage',       group: 'Configurazione', label: 'Gestire utenti e permessi', adminOnly: true },
];

// Voci di navigazione: ognuna richiede un permesso (`perm`). La voce Impostazioni
// è raggiungibile con UNO QUALSIASI dei permessi in `any` (contiene sotto-sezioni
// aspetto/aggiornamento/export/import/reset/aziende gestite da permessi distinti).
export const NAV = [
  { key: 'rie',    icon: '◷',  label: 'Riepilogo',       perm: 'riepilogo.view' },
  { key: 'comp',   icon: '🗓️', label: 'Presenze',        perm: 'presenze.view' },
  { key: 'turni',  icon: '🕐', label: 'Turni',           perm: 'turni.view' },
  { key: 'bse',    icon: '➕', label: 'Voci economiche',  perm: 'voci.view' },
  { key: 'dip',    icon: '👤', label: 'Dipendenti',       perm: 'dipendenti.view' },
  { key: 'sca',    icon: '⏳', label: 'Scadenze',         perm: 'scadenze.view' },
  { key: 'utenti', icon: '👥', label: 'Utenti',           perm: 'utenti.manage' },
  { key: 'set',    icon: '⚙',  label: 'Impostazioni',     perm: 'impostazioni.manage', any: ['impostazioni.manage', 'software.aggiorna', 'dati.export', 'dati.import', 'dati.reset', 'aziende.crea', 'aziende.modifica', 'aziende.elimina'] },
];

// Permessi che abilitano la scrittura dei DATI (collezioni). Derivati da `write`.
// Servono alla guardia grossolana su POST /api/changes: chi non ne ha nessuno è
// di sola lettura. NON includono le `.view`, le `.esporta` né la Configurazione.
export const DATA_MANAGE = PERMISSIONS.filter((p) => p.write).map((p) => p.key);

const PERM_INDEX = new Map(PERMISSIONS.map((p) => [p.key, p]));

// Un utente possiede un permesso? Gli admin hanno tutto; adminOnly solo agli admin.
export function hasPermission(user, key) {
  if (!user) return false;
  if (user.ruolo === 'admin') return true;
  const p = PERM_INDEX.get(key);
  if (p && p.adminOnly) return false;
  return Array.isArray(user.permessi) && user.permessi.includes(key);
}

// Verifica che almeno uno dei permessi sia posseduto.
export function hasAny(user, keys) {
  return keys.some((k) => hasPermission(user, k));
}

// Può scrivere i dati (ha almeno un permesso di gestione collezioni)? Gli admin sì.
export function canWriteData(user) {
  return hasAny(user, DATA_MANAGE);
}

// Voce di nav accessibile all'utente (usa `any` se presente, altrimenti `perm`).
export function canSeeNav(user, nav) {
  return nav.any ? hasAny(user, nav.any) : hasPermission(user, nav.perm);
}

// Permessi realmente assegnabili a un operatore standard (esclude gli adminOnly).
export function assegnabili() {
  return PERMISSIONS.filter((p) => !p.adminOnly);
}
