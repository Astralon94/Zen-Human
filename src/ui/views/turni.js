// ============ Vista Turni: pianificazione giorno×turno × ruoli ============
// Griglia di pianificazione in stile Zen-Staff, ma sui FATTI di Zen-Human: ogni cella
// (giorno · turno · ruolo) è un record `attendance` {status:'present', shift:<tipoId>,
// roleId:<ruoloId>, confirmed:false}. Nessuna collezione nuova. Le presenze CONFERMATE
// sono bloccate qui: si interviene prima in Presenze togliendo la conferma. Le scritture
// riusano i permessi presenze.crea/modifica/elimina; la vista è gated da turni.view (nav).
import { data, save } from '../../state/store.js';
import { can } from '../../state/auth.js';
import { STATUSES, companyShiftTypes, companyRoles } from '../../state/model.js';
import {
  esc, uid, fullName, initials, shiftMonth, pad2, todayStr, fmtDateFull, GIORNI, MESI, weekdayMon0
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
let brush = null;                    // id dipendente attivo, '__erase', oppure null

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
    ? `<button class="btn sm" id="btnPdfTable" title="PDF della tabella turni del periodo (uso interno)">🖨️ PDF tabella</button>
       <button class="btn sm" id="btnPngTable" title="PNG della tabella turni del periodo (immagine intera)">🖼️ PNG tabella</button>
       <button class="btn sm" id="btnZipEmp" title="ZIP con un PDF per dipendente (prospetto turni)">📦 ZIP dipendenti</button>`
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

  // barra pennello (scritture = permessi presenze.*)
  const canCrea = can('presenze.crea');
  const canDel = can('presenze.elimina');
  const canPaint = canCrea || canDel;
  if (!canPaint) brush = null;
  if (canPaint) {
    const chip = (id, inner, cls = '') => `<button class="chip ${cls} ${brush === id ? 'on' : ''}" data-brush="${id}">${inner}</button>`;
    let chips = '';
    if (canCrea) chips += emps.map(e => chip(e.id, `<span class="bc-ini" style="background:${esc(e.color || 'var(--accent)')}">${esc(initials(e))}</span>${esc(fullName(e))}`, 'brush-emp')).join('');
    if (canDel) chips += chip('__erase', '🧽 Gomma');
    h += `<div class="card" style="margin-bottom:8px">
      <div class="muted" style="font-size:12.5px;margin-bottom:8px">Scegli un dipendente e tocca le celle per assegnarlo al turno·ruolo. Ri-tocca la sua cella per rimuoverlo. Le presenze <b>confermate</b> (✓) non si modificano da qui: togli prima la conferma in <b>Presenze</b>.</div>
      <div class="chips" style="margin:0">${chips}</div>
    </div>`;
  }

  h += `<div class="turni-wrap ${brush !== null ? 'painting' : ''}" id="twrap">${gridHTML(cid, company, shifts, roles)}</div>`;
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
      const cells = roles.map(r => cellHTML(cid, d.date, t, r, locked)).join('');
      const altroCell = si === 0 ? altroHTML(cid, company, roles, shifts, d.date) : '';
      return `<tr class="${si === 0 ? 'day-first' : ''}${locked ? ' locked' : ''}">${dayCell}${shiftCell}${cells}${altroCell}</tr>`;
    }).join('');
  }

  const minW = 92 + 108 + roles.length * 108 + 150;
  return `<table class="turni" style="min-width:${minW}px"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

// cella giorno·turno·ruolo: pastiglia del dipendente assegnato oppure vuota
function cellHTML(cid, date, t, r, locked) {
  const rec = cellRecord(cid, date, t.id, r.id);
  const key = `${date}|${t.id}|${r.id}`;
  if (rec) {
    const e = emp(rec.employeeId);
    const nm = e ? shortName(e) : '?';
    const conf = rec.confirmed !== false;   // confermata → bloccata da qui
    return `<td class="tcell filled sh-${t.id}${conf ? ' confirmed' : ''}" data-cell="${key}" title="${esc(e ? fullName(e) : '?')} · ${esc(t.name)} · ${esc(r.name)}${conf ? ' · confermata (modifica in Presenze)' : ''}">${esc(nm)}${conf ? '<span class="tcheck">✓</span>' : ''}</td>`;
  }
  return `<td class="tcell empty${locked ? ' locked' : ''}" data-cell="${key}"></td>`;
}

// colonna "Altro" (sola lettura): assenze del giorno + presenti senza cella (no ruolo / non collocabili)
function altroHTML(cid, company, roles, shifts, date) {
  const NS = shifts.length;
  const roleIds = new Set(roles.map(r => r.id));
  const shiftIds = new Set(shifts.map(s => s.id));
  const empSet = new Set(companyEmployees(cid, { includeInactive: true }).map(e => e.id));
  const recs = data.attendance.filter(a => a.companyId === cid && a.date === date && empSet.has(a.employeeId));
  const pills = [];
  for (const a of recs) {
    const e = emp(a.employeeId); if (!e) continue;
    if (a.status === 'present') {
      // presente collocato in griglia? (ruolo valido + turno valido) → non va in Altro
      const placed = a.roleId && roleIds.has(a.roleId) && shiftIds.has(a.shift);
      if (placed) continue;
      pills.push(`<span class="altro-pill neutral" title="${esc(fullName(e))} · presente (senza ruolo)">${esc(shortName(e))}</span>`);
    } else {
      const s = statusInfo(a.status);
      pills.push(`<span class="altro-pill" style="background:${s.color}" title="${esc(fullName(e))} · ${esc(s.label)}">${esc(shortName(e))}<span class="altro-st">${s.short}</span></span>`);
    }
  }
  return `<td class="altrocol" rowspan="${NS}">${pills.join('') || '<span class="muted" style="font-size:11px">—</span>'}</td>`;
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
  const btnPdf = root.querySelector('#btnPdfTable');
  if (btnPdf) btnPdf.onclick = () => withBusy(btnPdf, '⏳ Genero…', async () => {
    const { blob, name } = await exportTablePdf(cid, periodDates());
    downloadBlob(name, blob); toast('PDF tabella generato');
  });
  const btnPng = root.querySelector('#btnPngTable');
  if (btnPng) btnPng.onclick = () => withBusy(btnPng, '⏳ Genero…', async () => {
    const { blob, name } = await exportTablePng(cid, periodDates());
    downloadBlob(name, blob); toast('PNG tabella generato');
  });
  const btnZip = root.querySelector('#btnZipEmp');
  if (btnZip) btnZip.onclick = () => withBusy(btnZip, '⏳ Genero…', async () => {
    const { blob, count, name } = await exportEmployeesZip(cid, periodDates());
    if (!count) { toast('Nessun turno assegnato nel periodo'); return; }
    downloadBlob(name, blob); toast(`ZIP con ${count} prospett${count === 1 ? 'o' : 'i'}`);
  });

  // pennello (dipendente / gomma)
  root.querySelectorAll('[data-brush]').forEach(b => b.onclick = () => {
    brush = brush === b.dataset.brush ? null : b.dataset.brush;
    root.querySelectorAll('[data-brush]').forEach(x => x.classList.toggle('on', x.dataset.brush === brush));
    root.querySelector('#twrap')?.classList.toggle('painting', brush !== null);
  });

  // celle
  root.querySelectorAll('td.tcell').forEach(td => td.onclick = () => onCellClick(cid, td, root));
}

// feedback discreto (mai alert): shake della cella + toast leggero
function nudge(td, msg) {
  if (td) { td.classList.remove('shake'); void td.offsetWidth; td.classList.add('shake'); setTimeout(() => td.classList.remove('shake'), 450); }
  if (msg) toast(msg);
}

function onCellClick(cid, td, root) {
  const [date, shiftId, roleId] = td.dataset.cell.split('|');
  const month = date.slice(0, 7);
  const rec = cellRecord(cid, date, shiftId, roleId);

  // cella confermata: mai modificabile da qui
  if (rec && rec.confirmed !== false) { nudge(td, 'Presenza confermata: togli la conferma in Presenze'); return; }

  if (isMonthLocked(cid, month)) { nudge(td, 'Mese chiuso: non modificabile'); return; }

  // gomma: rimuove la presenza non confermata della cella
  if (brush === '__erase') {
    if (!can('presenze.elimina')) return;
    if (rec) { data.attendance = data.attendance.filter(a => a !== rec); save(); rerender(root); }
    return;
  }

  // nessun pennello: niente da fare (le celle confermate hanno già dato feedback sopra)
  if (!brush) { if (rec) nudge(td); return; }

  // pennello = dipendente
  const e = emp(brush); if (!e) return;
  if (!can('presenze.crea')) return;

  // ri-clic sulla propria cella non confermata → rimuove
  if (rec && rec.employeeId === brush) {
    if (!can('presenze.elimina')) { nudge(td, 'Non hai il permesso di rimuovere'); return; }
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
    ex.shift = shiftId; ex.roleId = roleId;
  } else {
    data.attendance.push({ id: uid(), companyId: cid, employeeId: brush, date, status: 'present', amount: 0, shift: shiftId, shiftBonus: 0, roleId, confirmed: false, note: '' });
  }
  save(); rerender(root);
}

function rerender(root) {
  root.innerHTML = render();
  bind(root);
}
