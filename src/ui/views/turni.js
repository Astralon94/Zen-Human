// ============ Vista Turni: pianificazione giorno×turno × ruoli ============
// Griglia di pianificazione in stile Zen-Staff, ma sui FATTI di Zen-Human: ogni cella
// (giorno · turno · ruolo) è un record `attendance` {status:'present', shift:<tipoId>,
// roleId:<ruoloId>, confirmed:false}. Nessuna collezione nuova. Le presenze CONFERMATE
// sono bloccate qui: si interviene prima in Presenze togliendo la conferma. Le scritture
// hanno permessi propri turni.crea/modifica/elimina; la vista è gated da turni.view (nav).
import { data, save } from '../../state/store.js';
import { can } from '../../state/auth.js';
import { STATUSES, companyShiftTypes, companyRoles, EMPLOYEE_COLOR_FALLBACK } from '../../state/model.js';
import {
  esc, uid, fullName, initials, shiftMonth, pad2, todayStr, fmtDateFull, GIORNI, MESI, weekdayMon0, pickTextColor
} from '../../domain/util.js';
import { activeCompany, co, emp, companyEmployees, statusInfo, isMonthLocked } from '../../domain/payroll.js';
import { injectShiftScale } from '../shiftcolors.js';
import { toast } from '../dom.js';
import { exportTablePdf, exportTablePng, exportEmployeesZip } from '../../domain/turni-export.js';

// scarica un Blob come file (blob + a[download])
function downloadBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let viewMode = 'week';               // 'week' | 'range'
let weekAnchor = todayStr();         // una data dentro la settimana visualizzata (lun–dom)
let rangeFrom = null, rangeTo = null;
let brush = null;                    // id dipendente attivo, '__erase', '__extra__', '__move__', oppure null
const expandedAltro = new Set();     // date con la 1ª tendina "Altro" (assenze/fuori griglia) espansa
const expandedInsert = new Set();    // date con la 2ª tendina "Da inserire" espansa (indipendente dalla 1ª)
let dragSrc = null;                  // sorgente del drag in modalità Sposta: {date,shiftId,roleId}
let extraPop = null;                 // popover inline attivo per il nome di un Extra ({el, onOutside}) o null

// ---- helper intervallo di giorni ----
function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}
const weekStart = date => addDays(date, -weekdayMon0(date));
function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number), [by, bm, bd] = b.split('-').map(Number);
  return Math.round((new Date(by, bm - 1, bd) - new Date(ay, am - 1, ad)) / 86400000);
}
const rangeLen = () => daysBetween(rangeFrom, rangeTo) + 1;
function ensureRange() {
  if (!rangeFrom || !rangeTo) { const f = weekStart(todayStr()); rangeFrom = f; rangeTo = addDays(f, 6); }
}
// giorni [{day,date,dow,weekend,today}] tra due date comprese
function rangeDays(from, to) {
  if (!from || !to) return [];
  let a = from, b = to; if (a > b) { const t = a; a = b; b = t; }
  const out = [];
  for (let cur = a, i = 0; cur <= b && i < 400; cur = addDays(cur, 1), i++) {
    const dow = weekdayMon0(cur);
    out.push({ day: parseInt(cur.slice(8, 10), 10), date: cur, dow, weekend: dow >= 5, today: cur === todayStr() });
  }
  return out;
}
function viewDays() {
  if (viewMode === 'range') { ensureRange(); return rangeDays(rangeFrom, rangeTo); }
  const f = weekStart(weekAnchor);
  return rangeDays(f, addDays(f, 6));
}

// classe del contenitore griglia in base alla modalità pennello (cursore/interazione)
function wrapMode() { return brush === '__move__' ? 'moving' : (brush !== null ? 'painting' : ''); }

// nome breve per le pastiglie: "Mario R." (nome + iniziale del cognome); fallback al nome
function shortName(e) {
  const fn = (e.firstName || '').trim(), ln = (e.lastName || '').trim();
  if (!fn && !ln) return 'Senza nome';
  return ln ? `${fn} ${ln[0].toUpperCase()}.` : fn;
}

// ---- lookup sui fatti (attendance) ----
// record 'present' assegnato a quella cella (giorno·turno·ruolo) dell'azienda
function cellRecord(cid, date, shiftId, roleId) {
  return data.attendance.find(a =>
    a.companyId === cid && a.date === date && a.status === 'present' && a.shift === shiftId && a.roleId === roleId) || null;
}
// record del dipendente in quel giorno (al più uno: un dipendente = un record al giorno)
function dayRecordOf(cid, empId, date) {
  return data.attendance.find(a => a.companyId === cid && a.employeeId === empId && a.date === date) || null;
}

// ---- segnaposto "Extra" (collaboratori esterni, dentro il doc dell'azienda) ----
function extraList(company) { return Array.isArray(company?.extras) ? company.extras : []; }
// extra assegnato a quella cella (giorno·turno·ruolo); null se assente
function extraRecord(company, date, shiftId, roleId) {
  return extraList(company).find(x => x.date === date && x.shift === shiftId && x.roleId === roleId) || null;
}
// rimuove un extra dal doc dell'azienda (mutazione in place: il diff granulare lo rileva sul doc company)
function removeExtra(company, ex) {
  if (!company || !Array.isArray(company.extras)) return;
  company.extras = company.extras.filter(x => x !== ex);
}

export function render() {
  const cid = activeCompany();
  if (!cid) return `<div class="pagehead"><h1>Turni</h1></div><div class="card empty">Crea prima un'azienda dalla sezione Aziende.</div>`;
  const company = co(cid);
  injectShiftScale(company);
  const shifts = companyShiftTypes(company);
  const roles = companyRoles(company);
  const emps = companyEmployees(cid);

  const seg = `<div class="seg turni-mode">
      <button data-mode="week" class="${viewMode === 'week' ? 'on' : ''}">Settimana</button>
      <button data-mode="range" class="${viewMode === 'range' ? 'on' : ''}">Periodo</button>
    </div>`;
  let ctrl;
  if (viewMode === 'week') {
    const f = weekStart(weekAnchor);
    const lbl = `${parseInt(f.slice(8, 10), 10)} ${MESI[parseInt(f.slice(5, 7), 10) - 1].slice(0, 3)} – ${(() => { const t = addDays(f, 6); return `${parseInt(t.slice(8, 10), 10)} ${MESI[parseInt(t.slice(5, 7), 10) - 1].slice(0, 3)}`; })()}`;
    ctrl = `<button class="btn sm" data-wprev>‹</button>
      <span style="font-weight:700;min-width:150px;text-align:center">${esc(lbl)}</span>
      <button class="btn sm" data-wnext>›</button>
      <button class="btn sm" data-wtoday>Oggi</button>`;
  } else {
    ensureRange();
    ctrl = `<button class="btn sm" data-rprev>‹</button>
      <label class="rng-field">Dal <input type="date" id="rngFrom" value="${rangeFrom}"></label>
      <label class="rng-field">al <input type="date" id="rngTo" value="${rangeTo}"></label>
      <button class="btn sm" data-rnext>›</button>`;
  }

  // export del periodo visualizzato (visibili con la sezione: nessun permesso nuovo)
  const canExport = roles.length && shifts.length && emps.length;
  const exportBtns = canExport
    ? `<button class="btn sm" id="btnExport" title="Esporta la tabella turni o i prospetti per dipendente">📤 Esporta</button>`
    : '';

  let h = `<div class="pagehead"><h1>Turni</h1><span class="sub">${esc((company?.emoji || '') + ' ' + company?.name)}</span>
    <div class="btnrow" style="margin-left:auto">${seg}${ctrl}${exportBtns}</div></div>`;

  // servono almeno un ruolo e un tipo di turno
  if (!roles.length || !shifts.length) {
    h += `<div class="card empty">Per pianificare i turni configura almeno un <b>ruolo</b> e un <b>tipo di turno</b> in
      Impostazioni → Turni. ${roles.length ? '' : 'Nessun ruolo definito.'} ${shifts.length ? '' : 'Nessun tipo di turno definito.'}</div>`;
    return h;
  }
  if (!emps.length) { h += `<div class="card empty">Nessun dipendente attivo in questa azienda.</div>`; return h; }

  // barra pennello (scritture = permessi turni.*)
  const canCrea = can('turni.crea');
  const canDel = can('turni.elimina');
  const canMove = can('turni.modifica');
  const canPaint = canCrea || canDel || canMove;
  if (!canPaint) brush = null;
  if (canPaint) {
    const chip = (id, inner, cls = '') => `<button class="chip ${cls} ${brush === id ? 'on' : ''}" data-brush="${id}">${inner}</button>`;
    let chips = '';
    if (canCrea) chips += emps.map(e => {
      const c = e.color || EMPLOYEE_COLOR_FALLBACK;
      return chip(e.id, `<span class="bc-ini" style="background:${esc(c)};color:${pickTextColor(c)}">${esc(initials(e))}</span>${esc(fullName(e))}`, 'brush-emp');
    }).join('');
    if (canDel) chips += chip('__erase', '🧽 Gomma');
    // Extra: segnaposto testuale per un collaboratore ESTERNO (non in anagrafica); solo visivo. Creazione = turni.crea.
    if (canCrea) chips += chip('__extra__', '✳️ Extra', 'brush-extra');
    // Sposta: trascina le pastiglie tra le celle (sposta/scambia); permesso turni.modifica
    if (canMove) chips += chip('__move__', '↔️ Sposta', 'brush-move');
    h += `<div class="card" style="margin-bottom:8px">
      <div class="muted" style="font-size:12.5px;margin-bottom:8px">Scegli un dipendente e tocca le celle per assegnarlo al turno·ruolo. Ri-tocca la sua cella per rimuoverlo. Con <b>✳️ Extra</b> segni una cella coperta da un collaboratore esterno (solo nota, non è una presenza). Con <b>↔️ Sposta</b> trascini le pastiglie tra le celle (drop su cella occupata = scambio). Le presenze <b>confermate</b> (✓) non si modificano da qui: togli prima la conferma in <b>Presenze</b>.</div>
      <div class="chips" style="margin:0">${chips}</div>
    </div>`;
  }

  h += `<div class="turni-wrap ${wrapMode()}" id="twrap">${gridHTML(cid, company, shifts, roles)}</div>`;
  return h;
}

function gridHTML(cid, company, shifts, roles) {
  const days = viewDays();
  const NS = shifts.length;
  const spanMonths = new Set(days.map(d => d.date.slice(0, 7))).size > 1;

  const roleTh = roles.map(r => `<th class="rolecol" title="${esc(r.name)}"><span class="rn-full">${esc(r.name)}</span><span class="rn-acr">${esc(r.acronym || r.name.slice(0, 4).toUpperCase())}</span></th>`).join('');
  const head = `<th class="daycol">Giorno</th><th class="turnocol">Turno</th>${roleTh}<th class="altrocol">Altro</th>`;

  let body = '';
  for (const d of days) {
    const locked = isMonthLocked(cid, d.date.slice(0, 7));
    body += shifts.map((t, si) => {
      const monTag = spanMonths ? ` <span class="cd-mon">${esc(MESI[parseInt(d.date.slice(5, 7), 10) - 1].slice(0, 3))}</span>` : '';
      const dayCell = si === 0
        ? `<td class="daycol ${d.weekend ? 'wknd' : ''}${d.today ? ' today' : ''}" rowspan="${NS}"><div class="cd-day">${d.day} <span class="cd-dow">${GIORNI[d.dow]}</span>${monTag}</div>${d.today ? '<span class="cd-today">oggi</span>' : ''}</td>`
        : '';
      const shiftCell = `<td class="turnocol"><span class="sh-dot sh-${t.id}"></span>${esc(t.name)}</td>`;
      const cells = roles.map(r => cellHTML(cid, company, d.date, t, r, locked)).join('');
      const altroCell = si === 0 ? altroHTML(cid, company, roles, shifts, d.date) : '';
      return `<tr class="${si === 0 ? 'day-first' : ''}${locked ? ' locked' : ''}">${dayCell}${shiftCell}${cells}${altroCell}</tr>`;
    }).join('');
  }

  const minW = 92 + 108 + roles.length * 108 + 150;
  return `<table class="turni" style="min-width:${minW}px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// cella giorno·turno·ruolo: pastiglia del dipendente assegnato oppure vuota.
// Lo sfondo è il COLORE del dipendente (non più la scala verde del turno); il testo passa a
// nero/bianco secondo la luminanza (pickTextColor). In modalità Sposta le celle piene non
// confermate sono trascinabili (movable) e ogni cella non bloccata è bersaglio di drop (droptarget).
function cellHTML(cid, company, date, t, r, locked) {
  const rec = cellRecord(cid, date, t.id, r.id);
  const key = `${date}|${t.id}|${r.id}`;
  const move = brush === '__move__';
  if (rec) {
    const e = emp(rec.employeeId);
    const nm = e ? shortName(e) : '?';
    const conf = rec.confirmed !== false;   // confermata → bloccata da qui
    const bg = (e && e.color) || EMPLOYEE_COLOR_FALLBACK;
    const fg = pickTextColor(bg);
    const dnd = move && !conf && !locked;   // trascinabile e bersaglio
    const cls = `tcell filled${conf ? ' confirmed' : ''}${dnd ? ' movable droptarget' : ''}`;
    return `<td class="${cls}" style="background:${bg};color:${fg}" data-cell="${key}" data-emp="${esc(rec.employeeId)}"${dnd ? ' draggable="true"' : ''} title="${esc(e ? fullName(e) : '?')} · ${esc(t.name)} · ${esc(r.name)}${conf ? ' · confermata (modifica in Presenze)' : ''}"><span class="tpill">${esc(nm)}${conf ? '<span class="tcheck">✓</span>' : ''}</span></td>`;
  }
  // segnaposto "Extra" (collaboratore esterno): pastiglia grigia, non è una presenza. In modalità Sposta
  // è un bersaglio (per dare feedback discreto di rifiuto) ma NON è trascinabile.
  const ex = extraRecord(company, date, t.id, r.id);
  if (ex) {
    const drop = move && !locked;
    return `<td class="tcell extra${locked ? ' locked' : ''}${drop ? ' droptarget' : ''}" data-cell="${key}" title="${esc(ex.name)} · esterno (non in anagrafica) · ${esc(t.name)} · ${esc(r.name)}"><span class="extra-pill">${esc(ex.name)}</span></td>`;
  }
  const drop = move && !locked;
  return `<td class="tcell empty${locked ? ' locked' : ''}${drop ? ' droptarget' : ''}" data-cell="${key}"></td>`;
}

// colonna "Altro" (sola lettura): assenze del giorno + presenti senza cella (no ruolo / non collocabili).
// COLLASSABILE per giorno: di default mostra un riassunto compatto ("N assenze · M fuori griglia")
// con freccina ▸; al click si espande con tutte le pastiglie e freccina ▾. L'espansione allunga solo
// le righe di QUEL giorno (scelta più semplice e robusta: nessun overlay assoluto, l'omogeneità delle
// altre righe resta intatta). Senza contenuto: cella vuota senza freccina.
function altroHTML(cid, company, roles, shifts, date) {
  const NS = shifts.length;
  const s1 = altroBlockHTML(cid, roles, shifts, date);   // 1ª tendina: assenze + presenti fuori griglia
  const s2 = insertBlockHTML(cid, date);                  // 2ª tendina: dipendenti attivi non collocati
  const inner = (s1 || s2) ? (s1 + s2) : `<span class="muted" style="font-size:11px">—</span>`;
  return `<td class="altrocol" rowspan="${NS}">${inner}</td>`;
}

// 1ª tendina "Altro": assenze del giorno + presenti senza cella (no ruolo / non collocabili). '' se vuota.
function altroBlockHTML(cid, roles, shifts, date) {
  const roleIds = new Set(roles.map(r => r.id));
  const shiftIds = new Set(shifts.map(s => s.id));
  const empSet = new Set(companyEmployees(cid, { includeInactive: true }).map(e => e.id));
  const recs = data.attendance.filter(a => a.companyId === cid && a.date === date && empSet.has(a.employeeId));
  const pills = [];
  let nAbs = 0, nOut = 0;
  for (const a of recs) {
    const e = emp(a.employeeId); if (!e) continue;
    if (a.status === 'present') {
      // presente collocato in griglia? (ruolo valido + turno valido) → non va in Altro
      const placed = a.roleId && roleIds.has(a.roleId) && shiftIds.has(a.shift);
      if (placed) continue;
      nOut++;
      pills.push(`<span class="altro-pill neutral" data-emp="${esc(e.id)}" title="${esc(fullName(e))} · presente (senza ruolo)">${esc(shortName(e))}</span>`);
    } else {
      const s = statusInfo(a.status);
      nAbs++;
      pills.push(`<span class="altro-pill" data-emp="${esc(e.id)}" style="background:${s.color}" title="${esc(fullName(e))} · ${esc(s.label)}">${esc(shortName(e))}<span class="altro-st">${s.short}</span></span>`);
    }
  }
  if (!pills.length) return '';
  const open = expandedAltro.has(date);
  const parts = [];
  if (nAbs) parts.push(`${nAbs} assenz${nAbs === 1 ? 'a' : 'e'}`);
  if (nOut) parts.push(`${nOut} fuori griglia`);
  const summary = parts.join(' · ');
  const inner = open
    ? `<div class="altro-pills">${pills.join('')}</div>`
    : `<span class="altro-sum">${esc(summary)}</span>`;
  return `<div class="altro-block${open ? ' open' : ''}">
    <button type="button" class="altro-toggle" data-altro="${date}" title="${open ? 'Comprimi' : 'Espandi'}"><span class="altro-caret">${open ? '▾' : '▸'}</span>${inner}</button>
  </div>`;
}

// 2ª tendina "Da inserire": dipendenti ATTIVI dell'azienda senza ALCUN record attendance nel giorno
// (né turno/presenza né assenza). Gli Extra (esterni) NON contano come collocazione. Sola lettura.
// '' se sono tutti collocati (colonna pulita). Espandendola si allungano solo le righe di quel giorno.
function insertBlockHTML(cid, date) {
  const active = companyEmployees(cid);   // attivi
  if (!active.length) return '';
  const placed = new Set(data.attendance.filter(a => a.companyId === cid && a.date === date).map(a => a.employeeId));
  const missing = active.filter(e => !placed.has(e.id));
  if (!missing.length) return '';
  const open = expandedInsert.has(date);
  const pills = missing.map(e => {
    const c = e.color || EMPLOYEE_COLOR_FALLBACK;
    return `<span class="altro-pill" data-emp="${esc(e.id)}" style="background:${esc(c)};color:${pickTextColor(c)}" title="${esc(fullName(e))} · da inserire">${esc(shortName(e))}</span>`;
  }).join('');
  const inner = open
    ? `<div class="altro-pills">${pills}</div>`
    : `<span class="altro-sum">${missing.length} da inserire</span>`;
  return `<div class="insert-block${open ? ' open' : ''}">
    <button type="button" class="altro-toggle" data-insert="${date}" title="${open ? 'Comprimi' : 'Espandi'}"><span class="altro-caret">${open ? '▾' : '▸'}</span>${inner}</button>
  </div>`;
}

export function bind(root) {
  root.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
    if (viewMode === b.dataset.mode) return;
    viewMode = b.dataset.mode;
    if (viewMode === 'range') ensureRange();
    rerender(root);
  });
  // navigazione settimana
  root.querySelector('[data-wprev]')?.addEventListener('click', () => { weekAnchor = addDays(weekStart(weekAnchor), -7); rerender(root); });
  root.querySelector('[data-wnext]')?.addEventListener('click', () => { weekAnchor = addDays(weekStart(weekAnchor), 7); rerender(root); });
  root.querySelector('[data-wtoday]')?.addEventListener('click', () => { weekAnchor = todayStr(); rerender(root); });
  // navigazione periodo
  const rf = root.querySelector('#rngFrom'); if (rf) rf.onchange = () => { if (rf.value) { rangeFrom = rf.value; if (rangeTo < rangeFrom) rangeTo = rangeFrom; } rerender(root); };
  const rt = root.querySelector('#rngTo'); if (rt) rt.onchange = () => { if (rt.value) { rangeTo = rt.value; if (rangeTo < rangeFrom) rangeFrom = rangeTo; } rerender(root); };
  root.querySelector('[data-rprev]')?.addEventListener('click', () => { const n = rangeLen(); rangeFrom = addDays(rangeFrom, -n); rangeTo = addDays(rangeTo, -n); rerender(root); });
  root.querySelector('[data-rnext]')?.addEventListener('click', () => { const n = rangeLen(); rangeFrom = addDays(rangeFrom, n); rangeTo = addDays(rangeTo, n); rerender(root); });

  const cid = activeCompany();
  if (!cid) return;

  // export PDF/ZIP del periodo correntemente visualizzato (feedback discreto sul bottone)
  const withBusy = async (btn, label, fn) => {
    if (!btn || btn.disabled) return;
    const old = btn.innerHTML; btn.disabled = true; btn.innerHTML = label;
    try { await fn(); } catch (e) { toast('Errore durante l\'export'); }
    finally { btn.disabled = false; btn.innerHTML = old; }
  };
  const periodDates = () => viewDays().map(d => d.date);
  const btnExport = root.querySelector('#btnExport');
  // esegue la voce scelta dal menu Esporta (stato busy sul bottone durante la generazione)
  const runExport = (action) => withBusy(btnExport, '⏳ Genero…', async () => {
    if (action === 'pdf') {
      const { blob, name } = await exportTablePdf(cid, periodDates());
      downloadBlob(name, blob); toast('PDF tabella generato');
    } else if (action === 'png' || action === 'png-first' || action === 'png-id') {
      const nameMode = action === 'png-first' ? 'first' : action === 'png-id' ? 'id' : 'full';
      const { blob, name } = await exportTablePng(cid, periodDates(), 2, nameMode);
      downloadBlob(name, blob);
      toast(action === 'png-first' ? 'PNG tabella (solo nomi) generato' : action === 'png-id' ? 'PNG tabella (ID) generato' : 'PNG tabella generato');
    } else if (action === 'zip-pdf' || action === 'zip-png') {
      const format = action === 'zip-pdf' ? 'pdf' : 'png';
      const { blob, count, name } = await exportEmployeesZip(cid, periodDates(), 2, format);
      if (!count) { toast('Nessun turno assegnato nel periodo'); return; }
      downloadBlob(name, blob); toast(`ZIP con ${count} prospett${count === 1 ? 'o' : 'i'} ${format.toUpperCase()}`);
    }
  });
  // menu a tendina unico per tutti gli export (chiusura con Esc/click fuori)
  if (btnExport) btnExport.onclick = () => {
    if (btnExport.disabled) return;
    const openPop = document.querySelector('.export-pop');
    if (openPop) { openPop.remove(); return; }
    const r = btnExport.getBoundingClientRect();
    const pop = document.createElement('div');
    pop.className = 'extra-pop export-pop';
    pop.innerHTML = `<button class="btn sm" data-exp="pdf">🖨️ PDF tabella</button>
      <button class="btn sm" data-exp="png">🖼️ PNG tabella</button>
      <button class="btn sm" data-exp="png-first">🖼️ PNG tabella (solo nomi)</button>
      <button class="btn sm" data-exp="png-id">🪪 PNG tabella (ID)</button>
      <div class="exp-sep"></div>
      <button class="btn sm" data-exp="zip-pdf">📦 ZIP dipendenti · PDF</button>
      <button class="btn sm" data-exp="zip-png">📦 ZIP dipendenti · PNG</button>`;
    document.body.appendChild(pop);
    const left = Math.min(Math.round(r.left), window.innerWidth - pop.offsetWidth - 8);
    pop.style.left = Math.max(8, left) + 'px'; pop.style.top = Math.round(r.bottom + 4) + 'px';
    const close = () => { pop.remove(); document.removeEventListener('mousedown', onDoc, true); document.removeEventListener('keydown', onKey, true); };
    const onDoc = (ev) => { if (!pop.contains(ev.target) && ev.target !== btnExport) close(); };
    const onKey = (ev) => { if (ev.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    pop.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => { const a = b.dataset.exp; close(); runExport(a); });
  };

  // pennello (dipendente / gomma / Sposta)
  root.querySelectorAll('[data-brush]').forEach(b => b.onclick = () => {
    brush = brush === b.dataset.brush ? null : b.dataset.brush;
    dragSrc = null;
    root.querySelectorAll('[data-brush]').forEach(x => x.classList.toggle('on', x.dataset.brush === brush));
    // il passaggio da/verso "Sposta" cambia draggable/droptarget delle celle → ricostruisci la griglia
    regrid(root);
  });

  bindChipHover(root);
  bindGrid(root, cid);
}

// Passaggio del mouse su un chip-dipendente: evidenzia nella griglia (e nella colonna "Altro"
// visibile) tutte le celle/pastiglie dove quel dipendente compare nel periodo mostrato.
// Solo visuale: nessun cambio di stato. Delegation sul contenitore dei chip; le celle-bersaglio
// portano un attributo data-emp (aggiunto al render), niente listener per singola cella.
function bindChipHover(root) {
  const chipsWrap = root.querySelector('.chips');
  const twrap = root.querySelector('#twrap');
  if (!chipsWrap || !twrap) return;
  let cur = null;
  const clear = () => {
    if (cur == null) return;
    twrap.classList.remove('emp-hover');
    twrap.querySelectorAll('.hl').forEach(el => el.classList.remove('hl'));
    cur = null;
  };
  const apply = empId => {
    if (dragSrc) return;                 // durante un drag attivo l'evidenziazione è sospesa
    if (empId === cur) return;
    clear();
    const nodes = twrap.querySelectorAll(`[data-emp="${empId}"]`);
    if (!nodes.length) return;           // nessuna cella: non attenuare inutilmente le altre
    twrap.classList.add('emp-hover');
    nodes.forEach(el => el.classList.add('hl'));
    cur = empId;
  };
  chipsWrap.addEventListener('mouseover', ev => {
    const chip = ev.target.closest('.brush-emp');
    if (!chip || !chipsWrap.contains(chip)) { clear(); return; }
    apply(chip.dataset.brush);
  });
  chipsWrap.addEventListener('mouseleave', clear);
}

// (ri)aggancia gli handler della sola griglia: click celle, toggle "Altro", drag&drop
function bindGrid(root, cid) {
  const wrap = root.querySelector('#twrap');
  if (wrap) wrap.className = `turni-wrap ${wrapMode()}`;
  root.querySelectorAll('td.tcell').forEach(td => td.onclick = () => onCellClick(cid, td, root));
  root.querySelectorAll('.altro-toggle').forEach(b => b.onclick = () => {
    // due tendine indipendenti nella stessa cella Altro: assenze/fuori-griglia (data-altro) e "da inserire" (data-insert)
    if (b.dataset.altro != null) { const d = b.dataset.altro; expandedAltro.has(d) ? expandedAltro.delete(d) : expandedAltro.add(d); }
    else if (b.dataset.insert != null) { const d = b.dataset.insert; expandedInsert.has(d) ? expandedInsert.delete(d) : expandedInsert.add(d); }
    regrid(root);
  });
  bindDnd(root, cid);
}

// ricostruisce SOLO la griglia (#twrap) preservando lo scroll, e riaggancia gli handler.
function regrid(root) {
  closeExtraInput();
  const cid = activeCompany();
  if (!cid) return;
  const company = co(cid);
  const wrap = root.querySelector('#twrap');
  if (!wrap) { rerender(root); return; }
  const sl = wrap.scrollLeft, st = wrap.scrollTop;
  wrap.innerHTML = gridHTML(cid, company, companyShiftTypes(company), companyRoles(company));
  wrap.className = `turni-wrap ${wrapMode()}`;
  wrap.scrollLeft = sl; wrap.scrollTop = st;
  bindGrid(root, cid);
}

// ---- Sposta: drag & drop delle pastiglie tra celle (adattato da Zen-Staff) ----
function bindDnd(root, cid) {
  if (brush !== '__move__') return;
  const clearHi = () => root.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  // sorgenti: celle piene non confermate (già draggable=true)
  root.querySelectorAll('td.tcell.filled.movable[data-cell]').forEach(td => {
    td.ondragstart = ev => {
      const [date, shiftId, roleId] = td.dataset.cell.split('|');
      dragSrc = { date, shiftId, roleId };
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', td.dataset.cell); } catch (e) {}
      td.classList.add('dragging');
    };
    td.ondragend = () => { td.classList.remove('dragging'); clearHi(); dragSrc = null; };
  });
  // bersagli: ogni cella non bloccata (vuota o piena non confermata)
  root.querySelectorAll('td.tcell.droptarget[data-cell]').forEach(td => {
    td.ondragover = ev => { if (!dragSrc) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'move'; td.classList.add('drag-over'); };
    td.ondragleave = () => td.classList.remove('drag-over');
    td.ondrop = ev => {
      ev.preventDefault(); td.classList.remove('drag-over');
      const [date, shiftId, roleId] = td.dataset.cell.split('|');
      dropOnCell(cid, { date, shiftId, roleId }, td, root);
    };
  });
}

// Rilascio su una cella: sposta il turno trascinato; se la cella è occupata scambia i due occupanti.
// Rispetta i blocchi: presenze confermate e mesi chiusi non si toccano; un dipendente resta con un
// solo record al giorno (spostamento su un giorno diverso vietato se lì ha già un record/assenza).
function dropOnCell(cid, dst, td, root) {
  const src = dragSrc; if (!src) return;
  if (src.date === dst.date && src.shiftId === dst.shiftId && src.roleId === dst.roleId) return;
  const srcRec = cellRecord(cid, src.date, src.shiftId, src.roleId);
  if (!srcRec || srcRec.confirmed !== false) { nudge(td, 'Turno non spostabile'); return; }
  if (isMonthLocked(cid, src.date.slice(0, 7)) || isMonthLocked(cid, dst.date.slice(0, 7))) { nudge(td, 'Mese chiuso: non modificabile'); return; }
  // la destinazione è un segnaposto Extra (esterno): lo Sposta lo ignora, drop bloccato con feedback discreto
  if (extraRecord(co(cid), dst.date, dst.shiftId, dst.roleId)) { nudge(td, 'Cella occupata da un Extra: usa ✳️ o 🧽'); return; }
  const dstRec = cellRecord(cid, dst.date, dst.shiftId, dst.roleId);
  if (dstRec && dstRec.confirmed !== false) { nudge(td, 'Cella con presenza confermata: non modificabile'); return; }
  const sameDay = src.date === dst.date;

  if (!dstRec) {
    // cella vuota → sposta. Se cambia giorno, il dipendente non deve avere già un record lì.
    if (!sameDay) {
      const clash = dayRecordOf(cid, srcRec.employeeId, dst.date);
      if (clash) { nudge(td, `${fullName(emp(srcRec.employeeId))} ha già un record il ${fmtDateFull(dst.date)}`); return; }
    }
    srcRec.date = dst.date; srcRec.shift = dst.shiftId; srcRec.roleId = dst.roleId;
  } else {
    // cella occupata → SCAMBIO (entrambi non confermati). Se cambia giorno, verifica che nessuno dei
    // due abbia già un altro record nel giorno di destinazione.
    if (!sameDay) {
      const c1 = dayRecordOf(cid, srcRec.employeeId, dst.date);
      const c2 = dayRecordOf(cid, dstRec.employeeId, src.date);
      if (c1 && c1 !== dstRec) { nudge(td, `${fullName(emp(srcRec.employeeId))} ha già un record il ${fmtDateFull(dst.date)}`); return; }
      if (c2 && c2 !== srcRec) { nudge(td, `${fullName(emp(dstRec.employeeId))} ha già un record il ${fmtDateFull(src.date)}`); return; }
    }
    srcRec.date = dst.date; srcRec.shift = dst.shiftId; srcRec.roleId = dst.roleId;
    dstRec.date = src.date; dstRec.shift = src.shiftId; dstRec.roleId = src.roleId;
  }
  dragSrc = null;
  save(); regrid(root);
}

// feedback discreto (mai alert): shake della cella + toast leggero
function nudge(td, msg) {
  if (td) { td.classList.remove('shake'); void td.offsetWidth; td.classList.add('shake'); setTimeout(() => td.classList.remove('shake'), 450); }
  if (msg) toast(msg);
}

function onCellClick(cid, td, root) {
  if (brush === '__move__') return;   // in modalità Sposta si interagisce solo via drag&drop
  const key = td.dataset.cell;
  const [date, shiftId, roleId] = key.split('|');
  const month = date.slice(0, 7);
  const company = co(cid);
  const rec = cellRecord(cid, date, shiftId, roleId);
  const extra = rec ? null : extraRecord(company, date, shiftId, roleId);  // rec e extra sono mutuamente esclusivi per costruzione

  // cella confermata: mai modificabile da qui
  if (rec && rec.confirmed !== false) { nudge(td, 'Presenza confermata: togli la conferma in Presenze'); return; }

  if (isMonthLocked(cid, month)) { nudge(td, 'Mese chiuso: non modificabile'); return; }

  // gomma: rimuove la presenza non confermata OPPURE il segnaposto Extra della cella
  if (brush === '__erase') {
    if (!can('turni.elimina')) return;
    if (rec) { data.attendance = data.attendance.filter(a => a !== rec); save(); rerender(root); return; }
    if (extra) { removeExtra(company, extra); save(); regrid(root); }
    return;
  }

  // pennello Extra: apre l'input inline sulla cella (nuovo o modifica di uno esistente). Mai su cella con dipendente.
  if (brush === '__extra__') {
    if (!can('turni.crea')) return;
    if (rec) { nudge(td, 'Cella occupata da un dipendente'); return; }
    openExtraInput(cid, td, key, extra, root);
    return;
  }

  // nessun pennello: niente da fare (le celle confermate hanno già dato feedback sopra)
  if (!brush) { if (rec || extra) nudge(td); return; }

  // pennello = dipendente
  const e = emp(brush); if (!e) return;
  if (!can('turni.crea')) return;

  // ri-clic sulla propria cella non confermata → rimuove
  if (rec && rec.employeeId === brush) {
    if (!can('turni.elimina')) { nudge(td, 'Non hai il permesso di rimuovere'); return; }
    data.attendance = data.attendance.filter(a => a !== rec); save(); rerender(root); return;
  }

  // cella occupata da un altro: se confermato → già gestito sopra; se non confermato → sostituisci (rimuovi il suo legame)
  if (rec && rec.employeeId !== brush) {
    // rec è non confermato (i confermati escono prima): rimuovilo per liberare la cella
    data.attendance = data.attendance.filter(a => a !== rec);
  }

  // stato del dipendente pennellato in quel giorno (un solo record al giorno)
  const ex = dayRecordOf(cid, brush, date);
  if (ex) {
    if (ex.status !== 'present') { nudge(td, `${fullName(e)} ha già "${statusInfo(ex.status).label}" quel giorno`); return; }
    if (ex.confirmed !== false) { nudge(td, `${fullName(e)} ha una presenza confermata quel giorno`); return; }
    // presenza non confermata altrove → SPOSTA (aggiorna turno/ruolo)
    if (extra) removeExtra(company, extra);   // il titolare del turno "è arrivato": l'Extra lascia il posto
    ex.shift = shiftId; ex.roleId = roleId;
  } else {
    if (extra) removeExtra(company, extra);
    data.attendance.push({ id: uid(), companyId: cid, employeeId: brush, date, status: 'present', amount: 0, shift: shiftId, shiftBonus: 0, roleId, confirmed: false, note: '' });
  }
  save(); rerender(root);
}

// ---- Extra: input inline ancorato alla cella (mai prompt/alert) ----
// Chiude il popover Extra eventualmente aperto e stacca il listener di click-fuori.
function closeExtraInput() {
  if (!extraPop) return;
  document.removeEventListener('mousedown', extraPop.onOutside, true);
  extraPop.el.remove();
  extraPop = null;
}
// Apre un piccolo input sopra la cella per digitare/modificare il nome dell'Extra. Invio conferma,
// Esc/click-fuori annulla. Alla conferma salva il segnaposto nel doc dell'azienda e ridisegna la griglia.
function openExtraInput(cid, td, key, existing, root) {
  closeExtraInput();
  const [date, shiftId, roleId] = key.split('|');
  const company = co(cid);
  const el = document.createElement('div');
  el.className = 'extra-pop';
  el.innerHTML = `<input type="text" maxlength="40" placeholder="Nome esterno" value="${esc(existing?.name || '')}">`;
  document.body.appendChild(el);
  // posizionamento ancorato alla cella (position:fixed → coordinate viewport)
  const r = td.getBoundingClientRect();
  const w = Math.max(150, r.width);
  el.style.width = `${w}px`;
  let left = r.left; if (left + w > window.innerWidth - 8) left = window.innerWidth - 8 - w;
  el.style.left = `${Math.max(8, left)}px`;
  el.style.top = `${Math.min(window.innerHeight - 52, r.top)}px`;
  const inp = el.querySelector('input');

  const commit = () => {
    const name = inp.value.trim();
    closeExtraInput();
    if (!can('turni.crea')) return;
    if (isMonthLocked(cid, date.slice(0, 7))) { nudge(td, 'Mese chiuso: non modificabile'); return; }
    if (!name) return;                       // vuoto = nessuna modifica (annulla di fatto)
    if (existing) {
      if (existing.name === name) return;    // nessun cambiamento
      existing.name = name;
    } else {
      if (!Array.isArray(company.extras)) company.extras = [];
      company.extras.push({ id: uid(), date, shift: shiftId, roleId, name });
    }
    save(); regrid(root);
  };

  const onOutside = ev => { if (extraPop && !extraPop.el.contains(ev.target)) closeExtraInput(); };
  extraPop = { el, onOutside };
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); closeExtraInput(); }
  });
  // il click-fuori annulla; in cattura per intercettare prima degli altri handler
  setTimeout(() => document.addEventListener('mousedown', onOutside, true), 0);
  inp.focus(); inp.select();
}

function rerender(root) {
  closeExtraInput();
  root.innerHTML = render();
  bind(root);
}
