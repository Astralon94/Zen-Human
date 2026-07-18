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
  //   lockedMonths:['YYYY-MM'] (mesi "chiusi", inviati al consulente: presenze/voci di quel mese non modificabili),
  //   shiftTypes:[{id,name,start:'HH:MM',end:'HH:MM'}] (tipi di turno configurabili; ordine array = ordine righe
  //     e scala colore in Turni; gli id 'mattina'/'pomeriggio'/'notte' coincidono coi valori legacy di attendance.shift),
  //   roles:[{id,name,acronym}] (ruoli/mansioni; ordine array = ordine colonne in Turni; acronym max 4 maiuscolo),
  //   extras:[{id,date:'YYYY-MM-DD',shift:<tipoId>,roleId,name}] (segnaposto testuali "Extra" in Turni: una cella
  //     giorno·turno·ruolo coperta da un collaboratore ESTERNO non in anagrafica; SOLO visivo — non crea presenze,
  //     non entra in conteggi/netto)}
  companies: [{ id: 'co1', name: 'Azienda 1', emoji: '🏢', color: '#4f8a76', piva: '', cf: '', note: '', lockedMonths: [], shiftTypes: DEFAULT_SHIFT_TYPES(), roles: [], extras: [] }],
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
  //   shift (id di un tipo di turno dell'azienda, solo per "present"; i legacy 'mattina'/'pomeriggio'/'notte'
  //     coincidono con gli id di default), shiftBonus (bonus del turno, +netto),
  //   roleId (id di un ruolo dell'azienda|null, solo per "present"; descrittivo, ordina le colonne in Turni),
  //   confirmed (bool, solo per "present": presenza confermata dell'utente; una nuova nasce false), note,
  //   attachments:[{id,name,size,type,addedAt}] (certificati per malattia/infortunio; binari in attachments_bin)}
  attendance: [],
  // voci economiche mensili: {id,companyId,employeeId,month:'YYYY-MM',
  //   kind:'bonus'|'sanction'|'advance', amount, date, desc, createdAt (timestamp inserimento, per lo storico)}
  entries: []
});

// ---- Turni della giornata (solo per i giorni "Presente") ----
// I tipi di turno sono ora una LISTA LIBERA per azienda (company.shiftTypes). Le costanti
// qui sotto restano solo come FALLBACK/etichette legacy: il codice legge i tipi dall'azienda
// attiva via companyShiftTypes()/shiftTypeById(). Gli id di default coincidono con i valori
// legacy salvati in attendance.shift, quindi i dati esistenti restano validi senza migrazioni.
export const SHIFTS = {
  mattina:    { label: 'Mattina',    short: 'M', emoji: '🌅' },
  pomeriggio: { label: 'Pomeriggio', short: 'P', emoji: '🌤️' },
  notte:      { label: 'Notte',      short: 'N', emoji: '🌙' }
};
export const SHIFT_ORDER = ['mattina', 'pomeriggio', 'notte'];
export const shiftInfo = key => SHIFTS[key] || null;

// Tipi di turno di default per una nuova azienda (id = valori legacy). Ordine = ordine righe/scala colore.
export function DEFAULT_SHIFT_TYPES() {
  return [
    { id: 'mattina',    name: 'Mattina',    start: '06:00', end: '14:00' },
    { id: 'pomeriggio', name: 'Pomeriggio', start: '14:00', end: '22:00' },
    { id: 'notte',      name: 'Notte',      start: '22:00', end: '06:00' },
  ];
}
// Tipi di turno configurati per un'azienda (con fallback difensivo ai default se mancanti/vuoti).
export function companyShiftTypes(company) {
  if (company && Array.isArray(company.shiftTypes) && company.shiftTypes.length) return company.shiftTypes;
  return DEFAULT_SHIFT_TYPES();
}
// Lookup di un tipo di turno per id nell'azienda (null se non esiste).
export function shiftTypeById(company, id) {
  if (!id) return null;
  return companyShiftTypes(company).find(t => t.id === id) || null;
}
// Ruoli configurati per un'azienda (ordine array = ordine colonne in Turni).
export function companyRoles(company) {
  return (company && Array.isArray(company.roles)) ? company.roles : [];
}
export function roleById(company, id) {
  if (!id) return null;
  return companyRoles(company).find(r => r.id === id) || null;
}

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

// ---- Palette colori dipendente ----
// Tinte "zen" desaturate/armoniche (mix di chiare e scure), pensate per identificare a colpo
// d'occhio ogni dipendente nella griglia Turni. Il contrasto del testo (nero/bianco) è scelto
// a runtime da pickTextColor() in domain/util.js secondo la luminanza dello sfondo, quindi la
// palette può contenere tinte sia chiare sia scure senza problemi di leggibilità.
// Le prime 24 sono la ruota di Zen-Staff (armonizzata sui token --green/--red/--orange/--blue/
// --purple); le 16 successive estendono la gamma con tinte più profonde e alcune più chiare,
// mantenendo buona distinguibilità reciproca.
export const EMPLOYEE_COLORS = [
  '#8B5060', '#A56850', '#BC8C52', '#B19E77', '#9E8B3D', '#9B9959',
  '#9EB15D', '#65C3A0', '#479485', '#45A0B0', '#6788A8', '#6E9DB9',
  '#5F508B', '#9650A5', '#BC5278', '#B1779B', '#9E3D5E', '#9B6759',
  '#B16E5D', '#C39665', '#948147', '#5CB045', '#A8A867', '#B96E6E',
  '#3E6E63', '#4A5C7A', '#6B6F80', '#4C3F6E', '#8A7A66', '#6E7340',
  '#C08497', '#8FB89E', '#7FA9C9', '#A99BC4', '#A9803E', '#4F7A4A',
  '#8E6B84', '#B8A55C', '#5FA6A0', '#C77D6D'
];
// Colore di fallback per un dipendente senza tinta assegnata (grigio neutro).
export const EMPLOYEE_COLOR_FALLBACK = '#a8a59d';
// Prossima tinta da assegnare a un nuovo dipendente: la prima non ancora usata (per massima
// distinguibilità), altrimenti si ruota sulla palette in base al numero di dipendenti.
export function nextEmployeeColor(employees) {
  const used = new Set((employees || []).map(e => e && e.color).filter(Boolean));
  for (const c of EMPLOYEE_COLORS) if (!used.has(c)) return c;
  return EMPLOYEE_COLORS[(employees?.length || 0) % EMPLOYEE_COLORS.length];
}

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
  // aziende: mesi chiusi (blocco modifiche presenze/voci del mese) + tipi di turno e ruoli configurabili.
  // Chi non ha shiftTypes riceve i 3 default (id legacy → i record attendance esistenti restano validi);
  // chi non ha roles parte con lista vuota.
  d.companies.forEach(c => {
    if (!Array.isArray(c.lockedMonths)) c.lockedMonths = [];
    if (!Array.isArray(c.shiftTypes) || !c.shiftTypes.length) c.shiftTypes = DEFAULT_SHIFT_TYPES();
    if (!Array.isArray(c.roles)) c.roles = [];
    // segnaposto "Extra" (collaboratori esterni non in anagrafica) per la griglia Turni: solo visivi.
    if (!Array.isArray(c.extras)) c.extras = [];
  });
  // colore identificativo del dipendente (usato come sfondo nella griglia Turni). Chi non ce l'ha
  // (archivi pre-esistenti) riceve una tinta distinta a rotazione dalla palette, così i dipendenti
  // già presenti restano ben distinguibili senza intervento manuale.
  let colorRot = d.employees.filter(e => e && e.color).length;
  d.employees.forEach(e => {
    if (e.color == null || e.color === '') { e.color = EMPLOYEE_COLORS[colorRot % EMPLOYEE_COLORS.length]; colorRot++; }
  });
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
    if (a.roleId === undefined) a.roleId = null;   // ruolo del turno (solo "present"; descrittivo)
    if (!Array.isArray(a.attachments)) a.attachments = []; // certificati (malattia/infortunio)
    // conferma presenza (flag di workflow visivo): significativo solo per "present".
    // Storici privi del campo = già confermati (non devono apparire da riconfermare).
    if (a.status === 'present') { if (a.confirmed === undefined) a.confirmed = true; }
    else { a.confirmed = false; a.roleId = null; }   // roleId significativo solo per "present"
  });
  // voci: timestamp di inserimento per lo storico data/ora (retro-compat dai vecchi senza createdAt)
  d.entries.forEach(x => { if (x.createdAt == null) x.createdAt = (x.date ? Date.parse(x.date + 'T12:00:00') : 0) || Date.now(); });
  // azienda attiva sempre valida: se mancante o inesistente, ripiega sulla prima
  if (!d.settings.activeCompany || !d.companies.some(c => c.id === d.settings.activeCompany)) {
    d.settings.activeCompany = d.companies[0]?.id || null;
  }
  return d;
}
