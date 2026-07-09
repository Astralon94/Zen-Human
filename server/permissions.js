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
//  Modello (Livello A): autenticazione + gating UI + guardia di scrittura
//  GROSSOLANA sul backend (un solo endpoint dati). Nessun filtraggio del dataset
//  per utente: tutti gli autenticati caricano lo stato intero (app locale su un Mac).
//
//  Regole d'oro:
//   - Gli utenti con ruolo 'admin' hanno SEMPRE tutti i permessi.
//   - I permessi con adminOnly:true valgono solo per gli admin (non assegnabili).
//   - I permessi standard sono "particellari": assegnabili singolarmente.
// =============================================================================

export const RUOLI = { admin: 'Amministratore', standard: 'Operatore' };

// Catalogo permessi (particellari). `group` serve solo a raggrupparli nella UI.
export const PERMISSIONS = [
  { key: 'riepilogo.view',      group: 'Riepiloghi',     label: 'Vedere il riepilogo ed esportare i prospetti (PDF/CSV)' },
  { key: 'scadenze.view',       group: 'Riepiloghi',     label: 'Vedere le scadenze (contratti, libretti)' },

  { key: 'presenze.view',       group: 'Presenze',       label: 'Consultare le presenze' },
  { key: 'presenze.manage',     group: 'Presenze',       label: 'Compilare le presenze' },

  { key: 'voci.view',           group: 'Retribuzioni',   label: 'Consultare le voci economiche (bonus, sanzioni, acconti)' },
  { key: 'voci.manage',         group: 'Retribuzioni',   label: 'Gestire le voci economiche (bonus, sanzioni, acconti)' },

  { key: 'dipendenti.view',     group: 'Anagrafiche',    label: 'Consultare dipendenti, prestiti e stipendi' },
  { key: 'dipendenti.manage',   group: 'Anagrafiche',    label: 'Gestire dipendenti, prestiti e stipendi' },

  { key: 'aziende.manage',      group: 'Configurazione', label: 'Gestire le aziende' },
  { key: 'impostazioni.manage', group: 'Configurazione', label: 'Gestire le impostazioni e l\'aggiornamento software' },
  { key: 'dati.export',         group: 'Configurazione', label: 'Esportare il backup JSON' },
  { key: 'dati.import',         group: 'Configurazione', label: 'Importare/sostituire i dati (operazione totale)' },
  { key: 'utenti.manage',       group: 'Configurazione', label: 'Gestire utenti e permessi', adminOnly: true },
];

// Voci di navigazione: ognuna richiede un permesso (`perm`). La voce Impostazioni
// è raggiungibile con UNO QUALSIASI dei permessi in `any` (contiene sotto-sezioni
// export/import/aziende gestite da permessi distinti).
export const NAV = [
  { key: 'rie',    icon: '◷',  label: 'Riepilogo',       perm: 'riepilogo.view' },
  { key: 'comp',   icon: '🗓️', label: 'Compilazione',    perm: 'presenze.view' },
  { key: 'bse',    icon: '➕', label: 'Voci economiche',  perm: 'voci.view' },
  { key: 'dip',    icon: '👤', label: 'Dipendenti',       perm: 'dipendenti.view' },
  { key: 'sca',    icon: '⏳', label: 'Scadenze',         perm: 'scadenze.view' },
  { key: 'utenti', icon: '👥', label: 'Utenti',           perm: 'utenti.manage' },
  { key: 'set',    icon: '⚙',  label: 'Impostazioni',     perm: 'impostazioni.manage', any: ['impostazioni.manage', 'dati.export', 'dati.import', 'aziende.manage'] },
];

// Permessi che abilitano la scrittura dei DATI (collezioni). Servono alla guardia
// grossolana su POST /api/changes: chi non ne ha nessuno è di sola lettura.
export const DATA_MANAGE = [
  'presenze.manage', 'voci.manage', 'dipendenti.manage', 'aziende.manage',
];

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
