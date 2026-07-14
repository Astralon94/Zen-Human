// ============ Modello dati e default ============
// Principio chiave (ereditato da Inconty): si memorizzano solo i FATTI.
// Il NETTO mensile da pagare e i conteggi presenze/assenze NON sono mai salvati:
// sono SEMPRE derivati (vedi domain/payroll.js). Questo elimina disallineamenti
// e cambi di valore involontari dovuti a salvataggi/merge/migrazioni.

export const DATA_VERSION = 1;

export const DEFAULT_DATA = () => ({
  version: DATA_VERSION,
  rev: 0,                 // contatore monotòno: difende dagli overwrite con copie stale
  savedAt: 0,
  settings: { theme: 'auto', activeCompany: 'co1' },
  // aziende: dati completamente divisi tra loro. {id,name,emoji,color,piva,cf,note,
  //   lockedMonths:['YYYY-MM'] (mesi "chiusi", inviati al consulente: presenze/voci di quel mese non modificabili)}
  companies: [{ id: 'co1', name: 'Azienda 1', emoji: '🏢', color: '#4f8a76', piva: '', cf: '', note: '', lockedMonths: [] }],
  // dipendenti: {id,companyId,firstName,lastName,role,emoji,active,createdAt,
  //   contract (tipo contratto, testo libero), contractStart/contractEnd/contractOpen (scadenza contratto),
  //   librettoSanitario ('YYYY-MM-DD'|'' scadenza libretto sanitario),
  //   ferieAnnue (giorni di ferie/anno; 0 = non configurato), rolAnnui (giorni di permesso ROL/anno; 0 = non configurato),
  //   notePrivate (nota interna), noteConsultant (nota per il consulente),
  //   attachments:[{id,name,size,type,addedAt}] (documenti: contratti, ecc.; i binari vivono in attachments_bin),
  //   salaries:[{month:'YYYY-MM', net}]  (netto pattuito storicizzato per mese),
  //   loans:[{id,name,total,count,startMonth,amount,notes,createdAt,
  //     plan:[{n,month:'YYYY-MM',amount,status:'pending'|'paid',skipped}]}]}
  employees: [],
  // presenze: una riga per dipendente + giorno. {id,companyId,employeeId,date:'YYYY-MM-DD',
  //   status:STATUS_KEY, amount (importo da scalare dal netto, opzionale; per permesso_nr è override del netto/26),
  //   shift ('mattina'|'pomeriggio'|'notte'|null, solo per "present"), shiftBonus (bonus del turno, +netto), note,
  //   attachments:[{id,name,size,type,addedAt}] (certificati per malattia/infortunio; binari in attachments_bin)}
  attendance: [],
  // voci economiche mensili: {id,companyId,employeeId,month:'YYYY-MM',
  //   kind:'bonus'|'sanction'|'advance', amount, date, desc, createdAt (timestamp inserimento, per lo storico)}
  entries: []
});

// ---- Turni della giornata (solo per i giorni "Presente") ----
export const SHIFTS = {
  mattina:    { label: 'Mattina',    short: 'M', emoji: '🌅' },
  pomeriggio: { label: 'Pomeriggio', short: 'P', emoji: '🌤️' },
  notte:      { label: 'Notte',      short: 'N', emoji: '🌙' }
};
export const SHIFT_ORDER = ['mattina', 'pomeriggio', 'notte'];
export const shiftInfo = key => SHIFTS[key] || null;

// ---- Stati presenza/assenza ----
// kind: 'work' (lavorato), 'absence' (assenza/permesso), 'rest' (riposo, neutro).
// retrib: indicativo per il prospetto al consulente (l'importo da scalare resta manuale).
export const STATUSES = {
  present:     { label: 'Presente',               short: 'P',  emoji: '✅', kind: 'work',    retrib: true,  color: '#4f8a76' },
  ferie:       { label: 'Ferie',                  short: 'FE', emoji: '🏖️', kind: 'absence', retrib: true,  color: '#5b83a6' },
  malattia:    { label: 'Malattia',               short: 'M',  emoji: '🤒', kind: 'absence', retrib: true,  color: '#c98a52' },
  infortunio:  { label: 'Infortunio',             short: 'IN', emoji: '🩹', kind: 'absence', retrib: true,  color: '#c2685f' },
  permesso:    { label: 'Permesso (ROL)',         short: 'PR', emoji: '📝', kind: 'absence', retrib: true,  color: '#8b7fa8' },
  permesso_nr: { label: 'Permesso non retrib.',   short: 'PN', emoji: '🚫', kind: 'absence', retrib: false, color: '#9b86b3' },
  riposo:      { label: 'Riposo / non lavorativo', short: 'R', emoji: '⚪', kind: 'rest',    retrib: true,  color: '#a8a59d' }
};
export const STATUS_ORDER = ['present', 'ferie', 'malattia', 'infortunio', 'permesso', 'permesso_nr', 'riposo'];

export const ENTRY_KINDS = {
  bonus:   { label: 'Bonus',   emoji: '➕', sign: +1, color: '#4f8a76' },
  sanction:{ label: 'Sanzione', emoji: '⚠️', sign: -1, color: '#c2685f' },
  advance: { label: 'Acconto', emoji: '💶', sign: -1, color: '#c98a52' }
};

// Normalizza/ripara un archivio caricato (difensivo, non distruttivo).
export function migrate(d) {
  if (!d || typeof d !== 'object') return DEFAULT_DATA();
  d.version = DATA_VERSION;
  d.rev = d.rev || 0;
  d.settings = d.settings || { theme: 'auto', activeCompany: null };
  d.companies = Array.isArray(d.companies) ? d.companies : [];
  d.employees = Array.isArray(d.employees) ? d.employees : [];
  d.attendance = Array.isArray(d.attendance) ? d.attendance : [];
  d.entries = Array.isArray(d.entries) ? d.entries : [];
  delete d.log; // campo legacy non utilizzato
  // aziende: mesi chiusi (blocco modifiche presenze/voci del mese)
  d.companies.forEach(c => { if (!Array.isArray(c.lockedMonths)) c.lockedMonths = []; });
  d.employees.forEach(e => {
    if (!Array.isArray(e.salaries)) e.salaries = [];
    if (!Array.isArray(e.loans)) e.loans = [];
    e.loans.forEach(l => { if (!Array.isArray(l.plan)) l.plan = []; });
    if (e.active == null) e.active = true;
    if (e.contract == null) e.contract = '';
    if (e.contractStart == null) e.contractStart = '';   // 'YYYY-MM-DD' | ''
    if (e.contractEnd == null) e.contractEnd = '';        // 'YYYY-MM-DD' | '' (vuoto se indeterminato)
    if (e.contractOpen == null) e.contractOpen = false;   // true = tempo indeterminato (nessuna scadenza)
    if (e.librettoSanitario == null) e.librettoSanitario = ''; // 'YYYY-MM-DD' | '' scadenza libretto sanitario
    if (e.ferieAnnue == null) e.ferieAnnue = 0;           // giorni di ferie/anno (0 = non configurato)
    if (e.rolAnnui == null) e.rolAnnui = 0;               // giorni di permesso ROL/anno (0 = non configurato)
    if (e.notePrivate == null) e.notePrivate = '';
    if (e.noteConsultant == null) e.noteConsultant = '';
    if (!Array.isArray(e.attachments)) e.attachments = []; // documenti del dipendente
  });
  // presenze: campi turno (solo "present"), bonus turno e allegati (certificati)
  d.attendance.forEach(a => {
    if (a.shift === undefined) a.shift = null;
    if (a.shiftBonus == null) a.shiftBonus = 0;
    if (!Array.isArray(a.attachments)) a.attachments = []; // certificati (malattia/infortunio)
  });
  // voci: timestamp di inserimento per lo storico data/ora (retro-compat dai vecchi senza createdAt)
  d.entries.forEach(x => { if (x.createdAt == null) x.createdAt = (x.date ? Date.parse(x.date + 'T12:00:00') : 0) || Date.now(); });
  // azienda attiva sempre valida: se mancante o inesistente, ripiega sulla prima
  if (!d.settings.activeCompany || !d.companies.some(c => c.id === d.settings.activeCompany)) {
    d.settings.activeCompany = d.companies[0]?.id || null;
  }
  return d;
}
