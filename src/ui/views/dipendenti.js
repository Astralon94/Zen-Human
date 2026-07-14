// ============ Vista Dipendenti: elenco + scheda completa ============
import { data, save } from '../../state/store.js';
import { can } from '../../state/auth.js';
import { STATUS_ORDER, STATUSES, ENTRY_KINDS, SHIFT_ORDER, SHIFTS, shiftInfo } from '../../state/model.js';
import {
  esc, uid, fmt, fmtNum, parseAmount, fullName, initials,
  thisMonth, shiftMonth, fmtMonth, daysInMonth, weekdayMon0, pad2, todayStr, GIORNI, fmtDateFull
} from '../../domain/util.js';
import {
  activeCompany, co, emp, companyEmployees, salaryFor, setSalary,
  monthEntries, attendanceCell, attendanceStats, monthlyNet, cellDeduction,
  buildLoanPlan, loanResiduo, loanPaid, loanInstallmentsForMonth, statusInfo, entryInfo,
  isMonthLocked, leaveStats
} from '../../domain/payroll.js';
import { daysUntil, deadlineTone, deadlineLabel, DEADLINE_TYPES } from '../../domain/deadlines.js';
import { openSheet, closeSheet, confirmDialog, toast } from '../dom.js';
import { attachmentsHTML, bindAttachments } from '../attachments.js';

let selectedId = null;
let month = thisMonth();
let brush = null; // null = modalità Dettaglio; '__erase' = gomma; altrimenti chiave stato

export function render() {
  const cid = activeCompany();
  if (!cid) return `<div class="pagehead"><h1>Dipendenti</h1></div><div class="card empty">Crea prima un'azienda dalla sezione Aziende.</div>`;
  if (selectedId && emp(selectedId) && emp(selectedId).companyId === cid) return renderDetail(emp(selectedId));
  selectedId = null;
  return renderList(cid);
}

// ---------- ELENCO ----------
function renderList(cid) {
  const canCrea = can('dipendenti.crea');
  const list = companyEmployees(cid, { includeInactive: true });
  let h = `<div class="pagehead"><h1>Dipendenti</h1><span class="sub">${esc((co(cid)?.emoji || '') + ' ' + co(cid)?.name)}</span><span class="grow"></span>
    ${canCrea ? '<button class="btn primary" data-new>+ Nuovo dipendente</button>' : ''}</div>`;
  if (!list.length) { h += `<div class="card empty">Nessun dipendente.${canCrea ? '<br><button class="btn primary sm" data-new style="margin-top:10px">Aggiungi il primo</button>' : ''}</div>`; return h; }
  h += `<div class="list">${list.map(e => {
    const net = monthlyNet(e, month).net;
    const inactive = e.active === false;
    return `<div class="row click" data-emp="${e.id}">
      <div class="avatar" style="background:${esc(e.color || '#4f8a76')}">${esc(initials(e))}</div>
      <div class="mid"><div class="t1">${esc(fullName(e))} ${inactive ? '<span class="badge line">cessato</span>' : ''}${contractBadge(e)}${librettoBadge(e)}</div>
        <div class="t2">${esc(e.role || 'Senza mansione')}</div></div>
      <div class="amt tnum">${fmt(net)}<div class="t2" style="font-weight:500">${esc(fmtMonth(month))}</div></div>
    </div>`;
  }).join('')}</div>`;
  return h;
}

// badge di scadenza contratto: avviso quando manca ≤ 20 giorni, o se già scaduto (solo a termine)
function contractBadge(e) {
  if (e.contractOpen || !e.contractEnd) return '';
  const days = Math.round((new Date(e.contractEnd + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000);
  if (days < 0) return ' <span class="badge" style="background:#c2685f">contratto scaduto</span>';
  if (days <= 20) return ` <span class="badge" style="background:#c98a52">scade tra ${days}g</span>`;
  return '';
}

// badge scadenza libretto sanitario: avviso quando manca ≤ 30 giorni, o se già scaduto
function librettoBadge(e) {
  if (!e.librettoSanitario) return '';
  const days = daysUntil(e.librettoSanitario);
  const t = deadlineTone(days, DEADLINE_TYPES.libretto.warnAt);
  if (t.level === 'expired') return ' <span class="badge" style="background:#c2685f">libretto scaduto</span>';
  if (t.level === 'soon') return ` <span class="badge" style="background:#c98a52">libretto ${esc(deadlineLabel(days))}</span>`;
  return '';
}

// periodo contrattuale leggibile: "dal 01/01/2026 · indeterminato" oppure "01/01/2026 → 31/12/2026"
function contractPeriod(e) {
  const s = e.contractStart ? fmtDateFull(e.contractStart) : '';
  if (e.contractOpen) return s ? `dal ${s} · indeterminato` : 'tempo indeterminato';
  const end = e.contractEnd ? fmtDateFull(e.contractEnd) : '';
  if (s && end) return `${s} → ${end}`;
  if (s) return `dal ${s}`;
  if (end) return `fino al ${end}`;
  return '';
}

// ---------- SCHEDA DIPENDENTE ----------
function renderDetail(e) {
  const canEditEmp = can('dipendenti.modifica') || can('dipendenti.elimina');   // la scheda modifica ospita anche l'elimina
  const locked = isMonthLocked(e.companyId, month);   // mese chiuso: presenze/voci del mese non modificabili
  const canVoci = can('voci.crea') && !locked;
  if (locked || (!can('presenze.crea') && !can('presenze.elimina'))) brush = null;   // niente pennello: il tocco apre la scheda del giorno
  let h = `<div class="pagehead">
    <button class="btn sm" data-back>‹ Dipendenti</button>
    <span class="grow"></span>
    ${canEditEmp ? '<button class="btn sm" data-editemp>Modifica</button>' : ''}
  </div>`;

  h += `<div class="card" style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
    <div class="avatar" style="width:46px;height:46px;font-size:16px;background:${esc(e.color || '#4f8a76')}">${esc(initials(e))}</div>
    <div style="flex:1;min-width:0">
      <div style="font-weight:800;font-size:18px">${esc(fullName(e))} ${e.active === false ? '<span class="badge line">cessato</span>' : ''}${contractBadge(e)}${librettoBadge(e)}</div>
      <div class="muted" style="font-size:13px">${esc(e.role || 'Senza mansione')}${e.contract ? ' · 📄 ' + esc(e.contract) : ''}${e.iban ? ' · IBAN ' + esc(e.iban) : ''}</div>
      ${contractPeriod(e) ? `<div class="muted" style="font-size:12.5px;margin-top:2px">📅 ${contractPeriod(e)}</div>` : ''}
      ${e.librettoSanitario ? `<div class="muted" style="font-size:12.5px;margin-top:2px">🩺 Libretto sanitario: scad. ${fmtDateFull(e.librettoSanitario)}</div>` : ''}
    </div>
  </div>`;

  // note (privata / per il consulente) se presenti
  if (e.notePrivate || e.noteConsultant) {
    h += `<div class="card" style="margin-bottom:14px;font-size:13px">
      ${e.notePrivate ? `<div style="margin-bottom:${e.noteConsultant ? '8px' : '0'}"><b>🔒 Nota privata</b><div class="muted" style="white-space:pre-wrap">${esc(e.notePrivate)}</div></div>` : ''}
      ${e.noteConsultant ? `<div><b>📋 Nota per il consulente</b><div class="muted" style="white-space:pre-wrap">${esc(e.noteConsultant)}</div></div>` : ''}
    </div>`;
  }

  // documenti del dipendente (contratti, documenti d'identità, ecc.)
  h += `<div class="section-title">Documenti</div>`;
  h += `<div id="d_docs">${docsInner(e)}</div>`;

  // navigatore mese
  h += monthNav();

  // banner mese chiuso
  if (locked) h += `<div class="card" style="margin-bottom:8px;border-left:3px solid var(--accent);background:var(--accent-soft);font-size:13px">🔒 <b>Mese chiuso</b> — inviato al consulente. Presenze e voci di ${esc(fmtMonth(month))} non sono modificabili.</div>`;

  // netto del mese
  h += `<div class="section-title">Netto del mese</div>`;
  h += `<div class="card" id="d_net">${netInner(e)}</div>`;

  // ferie e permessi ROL residui (anno del mese visualizzato; solo se il monte è configurato)
  const lv = leaveStats(e, month.slice(0, 4));
  if (lv.ferieConfig || lv.rolConfig) {
    h += `<div class="section-title">Ferie e permessi · ${esc(month.slice(0, 4))}</div>`;
    h += `<div class="card" style="font-size:13.5px;line-height:1.7">${leaveLine(lv)}</div>`;
  }

  // presenze
  h += `<div class="section-title">Presenze · <span id="d_stats" class="muted" style="text-transform:none;letter-spacing:0;font-weight:600">${statsText(e)}</span><span class="grow"></span></div>`;
  h += brushBar(locked);
  h += `<div class="card" id="d_cal">${calInner(e)}</div>`;
  h += legend();

  // voci del mese
  h += `<div class="section-title">Voci del mese<span class="grow"></span>${canVoci ? '<button class="btn sm" data-newentry>+ Voce</button>' : ''}</div>`;
  const ents = monthEntries(e, month).slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (!ents.length) h += `<div class="card empty">Nessun bonus, sanzione o acconto in ${esc(fmtMonth(month))}.</div>`;
  else h += `<div class="list">${ents.map(x => {
    const info = entryInfo(x.kind);
    const cls = info.sign > 0 ? 'pos' : 'neg';
    return `<div class="row click" data-entry="${x.id}">
      <div class="emoji">${info.emoji}</div>
      <div class="mid"><div class="t1">${esc(info.label)}${x.desc ? ' · ' + esc(x.desc) : ''}</div><div class="t2">${x.date ? fmtDateFull(x.date) : ''}</div></div>
      <div class="amt tnum ${cls}">${info.sign > 0 ? '+' : '−'} ${fmt(x.amount)}</div>
    </div>`;
  }).join('')}</div>`;

  // prestiti
  h += `<div class="section-title">Prestiti rateizzati<span class="grow"></span>${can('prestiti.crea') ? '<button class="btn sm" data-newloan>+ Prestito</button>' : ''}</div>`;
  const loans = e.loans || [];
  if (!loans.length) h += `<div class="card empty">Nessun prestito attivo.</div>`;
  else h += loans.map(l => {
    const res = loanResiduo(l), paid = loanPaid(l), tot = paid + res || 1;
    const dueThis = loanInstallmentsForMonth(e, month).filter(x => x.loan.id === l.id);
    return `<div class="card click" data-loan="${l.id}" style="margin-bottom:10px;cursor:pointer">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="flex:1;min-width:0"><div style="font-weight:700">🏦 ${esc(l.name || 'Prestito')}</div>
          <div class="muted" style="font-size:12.5px">Residuo ${fmt(res)} di ${fmt(paid + res)}${dueThis.length ? ' · rata questo mese ' + fmt(dueThis.reduce((s, x) => s + x.inst.amount, 0)) : ''}</div></div>
        <div class="muted">›</div>
      </div>
      <div class="bar"><i style="width:${Math.min(100, paid / tot * 100)}%"></i></div>
    </div>`;
  }).join('');

  return h;
}

function monthNav() {
  return `<div class="card" style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
    <button class="btn sm" data-mprev>‹</button>
    <div style="flex:1;text-align:center;font-weight:700">${esc(fmtMonth(month))}</div>
    <button class="btn sm" data-mnext>›</button>
    <button class="btn sm" data-mtoday>Oggi</button>
  </div>`;
}

function netInner(e) {
  const n = monthlyNet(e, month);
  return `<table class="tbl">
      <tr><td>Stipendio netto pattuito</td><td class="r tnum">${fmt(n.base)}</td></tr>
      ${n.bonus ? `<tr><td>Bonus</td><td class="r tnum pos">+ ${fmt(n.bonus)}</td></tr>` : ''}
      ${n.shiftBonus ? `<tr><td>Bonus turni</td><td class="r tnum pos">+ ${fmt(n.shiftBonus)}</td></tr>` : ''}
      ${n.sanctions ? `<tr><td>Sanzioni</td><td class="r tnum neg">− ${fmt(n.sanctions)}</td></tr>` : ''}
      ${n.advances ? `<tr><td>Acconti</td><td class="r tnum neg">− ${fmt(n.advances)}</td></tr>` : ''}
      ${n.loans ? `<tr><td>Rate prestiti</td><td class="r tnum neg">− ${fmt(n.loans)}</td></tr>` : ''}
      ${n.absences ? `<tr><td>Trattenute assenze</td><td class="r tnum neg">− ${fmt(n.absences)}</td></tr>` : ''}
      <tr class="tot"><td>Netto da pagare</td><td class="r tnum">${fmt(n.net)}</td></tr>
    </table>
    ${(can('stipendi.crea') || can('stipendi.elimina')) ? '<div class="btnrow" style="margin-top:12px"><button class="btn sm" data-salary>Stipendio pattuito…</button></div>' : ''}`;
}

function statsText(e) {
  const st = attendanceStats(e, month);
  return `${st.worked} lavorati · ${st.absences} assenze`;
}

// barra di compilazione rapida (pennello): stati con presenze.crea, gomma con presenze.elimina.
// Nei mesi chiusi non compare (nessuna scrittura di presenze).
function brushBar(locked) {
  const canCrea = can('presenze.crea') && !locked, canDel = can('presenze.elimina') && !locked;
  if (!canCrea && !canDel) return '';
  const b = (key, label, title) => `<button class="chip ${(brush || '') === key ? 'on' : ''}" data-brush="${key}" title="${esc(title)}">${label}</button>`;
  return `<div class="card" id="d_brush" style="margin-bottom:8px">
    <div class="muted" style="font-size:12.5px;margin-bottom:8px">Compilazione rapida: scegli uno stato e tocca i giorni. In <b>Dettaglio</b> il tocco apre la scheda del giorno (importi e note).</div>
    <div class="chips" style="margin:0">
      ${b('', '✏️ Dettaglio', 'Dettaglio: apre la scheda del giorno')}
      ${canCrea ? STATUS_ORDER.map(k => b(k, `${STATUSES[k].emoji} ${STATUSES[k].short}`, STATUSES[k].label)).join('') : ''}
      ${canDel ? b('__erase', '🧽 Gomma', 'Svuota il giorno') : ''}
    </div>
  </div>`;
}

function calInner(e) {
  const dim = daysInMonth(month);
  const firstDow = weekdayMon0(`${month}-01`);
  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += `<div class="day empty"></div>`;
  for (let d = 1; d <= dim; d++) {
    const ds = `${month}-${pad2(d)}`;
    const cell = attendanceCell(e, ds);
    const dow = weekdayMon0(ds);
    const wknd = dow >= 5;
    const today = ds === todayStr();
    let style = '', cls = 'day';
    if (cell) { const info = statusInfo(cell.status); style = `background:${info.color};`; cls += ' set'; }
    if (wknd) cls += ' wknd';
    if (today) cls += ' today';
    const ded = cell ? cellDeduction(e, month, cell) : 0;
    const sh = cell && cell.shift ? shiftInfo(cell.shift) : null;
    cells += `<div class="${cls}" style="${style}" data-day="${ds}">
      <div class="dn">${d}</div>
      ${cell ? `<div class="st">${statusInfo(cell.status).emoji}${sh ? ' <span style="font-size:9px;opacity:.85">' + sh.emoji + '</span>' : ''}${cell.attachments?.length ? ' <span style="font-size:9px">📎</span>' : ''}</div>` : ''}
      ${cell && cell.shiftBonus ? `<div class="ded" style="color:#4f8a76">+${fmtNum(cell.shiftBonus)}</div>` : (ded ? `<div class="ded">−${fmtNum(ded)}</div>` : '')}
    </div>`;
  }
  const dows = GIORNI.map(g => `<div class="dow">${g}</div>`).join('');
  return `<div class="cal">${dows}${cells}</div>`;
}

function legend() {
  return `<div class="legend">${STATUS_ORDER.map(k => {
    const s = STATUSES[k];
    return `<span class="tag"><i style="background:${s.color}"></i>${s.emoji} ${esc(s.label)}</span>`;
  }).join('')}</div>`;
}

// documenti del dipendente (allegati su employee.attachments[])
function docsInner(e) {
  return attachmentsHTML(e.attachments, { canEdit: can('dipendenti.modifica'), idPrefix: 'doc', empty: 'Nessun documento allegato.' });
}

// certificato allegabile solo a malattia/infortunio (record già persistito)
function certEligible(cell) { return !!cell && (cell.status === 'malattia' || cell.status === 'infortunio'); }
function certBlockHTML(cell, canEdit) {
  if (!certEligible(cell)) return '';
  return `<div class="field"><label>📎 Certificato · ${esc(STATUSES[cell.status].label)}</label>
    ${attachmentsHTML(cell.attachments, { canEdit, idPrefix: 'cert', empty: 'Nessun certificato allegato.' })}</div>`;
}

// giorni: interi senza decimali, altrimenti due cifre
const fmtDays = n => Number.isInteger(n) ? String(n) : fmtNum(n);
// riga ferie/ROL residui (rosso se il residuo è negativo)
function leaveLine(s) {
  const parts = [];
  if (s.ferieConfig) parts.push(`🏖️ <b>Ferie</b>: ${s.ferieUsed}/${fmtDays(s.ferieAnnue)} → <b class="${s.ferieLeft < 0 ? 'neg' : ''}">restano ${fmtDays(s.ferieLeft)}</b>`);
  if (s.rolConfig) parts.push(`📝 <b>Permessi ROL</b>: ${s.rolUsed}/${fmtDays(s.rolAnnui)} → <b class="${s.rolLeft < 0 ? 'neg' : ''}">restano ${fmtDays(s.rolLeft)}</b>`);
  return parts.join('<br>');
}

// ---------- BIND ----------
export function bind(root) {
  if (selectedId && emp(selectedId)) return bindDetail(root, emp(selectedId));
  root.querySelectorAll('[data-new]').forEach(b => b.onclick = () => empSheet(null));
  root.querySelectorAll('[data-emp]').forEach(b => b.onclick = () => { selectedId = b.dataset.emp; rerender(); });
}

function bindDetail(root, e) {
  root.querySelector('[data-back]').onclick = () => { selectedId = null; brush = null; rerender(); };
  root.querySelector('[data-editemp]')?.addEventListener('click', () => empSheet(e));
  root.querySelector('[data-mprev]').onclick = () => { month = shiftMonth(month, -1); rerender(); };
  root.querySelector('[data-mnext]').onclick = () => { month = shiftMonth(month, 1); rerender(); };
  root.querySelector('[data-mtoday]').onclick = () => { month = thisMonth(); rerender(); };
  root.querySelector('[data-newentry]')?.addEventListener('click', () => entrySheet(e, null));
  root.querySelector('[data-newloan]')?.addEventListener('click', () => loanSheet(e, null));
  root.querySelectorAll('[data-entry]').forEach(b => b.onclick = () => entrySheet(e, b.dataset.entry));
  root.querySelectorAll('[data-loan]').forEach(b => b.onclick = () => loanDetailSheet(e, b.dataset.loan));
  // pennello: selezione stato
  root.querySelectorAll('[data-brush]').forEach(b => b.onclick = () => {
    brush = b.dataset.brush ? b.dataset.brush : null;
    root.querySelectorAll('[data-brush]').forEach(x => x.classList.toggle('on', (x.dataset.brush || '') === (brush || '')));
    setCalCursor(root);
  });
  bindSalary(root, e);
  bindDays(root, e);
  bindDocs(root, e);
  setCalCursor(root);
}

// documenti del dipendente: aggiungi/apri/elimina (refresh in place della sola sezione)
function bindDocs(root, e) {
  const scope = root.querySelector('#d_docs');
  if (!scope) return;
  bindAttachments(scope, {
    getAtts: () => (e.attachments ||= []),
    setAtts: arr => { e.attachments = arr; },
    canEdit: can('dipendenti.modifica'), idPrefix: 'doc',
    onChange: () => { save(); scope.innerHTML = docsInner(e); bindDocs(root, e); },
  });
}

function bindSalary(root, e) { const s = root.querySelector('[data-salary]'); if (s) s.onclick = () => salarySheet(e); }
function bindDays(root, e) {
  root.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
    if (brush === null) daySheet(e, b.dataset.day);
    else paintDay(e, b.dataset.day);
  });
}
function setCalCursor(root) {
  const cal = root.querySelector('#d_cal');
  if (cal) cal.querySelectorAll('.day:not(.empty)').forEach(d => d.style.cursor = brush !== null ? 'crosshair' : 'pointer');
}

// applica lo stato del pennello a un giorno, aggiornando in-place (niente salto scroll)
function paintDay(e, ds) {
  // gomma = eliminazione; stato = compilazione (crea)
  if (brush === '__erase' ? !can('presenze.elimina') : !can('presenze.crea')) return;
  if (isMonthLocked(e.companyId, month)) return;   // mese chiuso: niente scritture
  const ex = data.attendance.find(a => a.employeeId === e.id && a.date === ds);
  if (brush === '__erase') {
    if (ex) data.attendance = data.attendance.filter(a => a !== ex);
  } else {
    const isAbs = STATUSES[brush]?.kind === 'absence';
    if (ex) { const same = ex.status === brush; ex.status = brush; ex.amount = isAbs ? (same ? ex.amount || 0 : 0) : 0; if (brush !== 'present') { ex.shift = null; ex.shiftBonus = 0; } }
    else data.attendance.push({ id: uid(), companyId: e.companyId, employeeId: e.id, date: ds, status: brush, amount: 0, shift: null, shiftBonus: 0, note: '' });
  }
  save();
  refreshInPlace(e);
}

// aggiorna solo netto, calendario e statistiche senza ricostruire l'intera scheda
function refreshInPlace(e) {
  const root = document.getElementById('view');
  const net = root.querySelector('#d_net'); if (net) net.innerHTML = netInner(e);
  const cal = root.querySelector('#d_cal'); if (cal) cal.innerHTML = calInner(e);
  const stats = root.querySelector('#d_stats'); if (stats) stats.textContent = statsText(e);
  bindSalary(root, e);
  bindDays(root, e);
  setCalCursor(root);
}

function rerender() {
  const root = document.getElementById('view');
  root.innerHTML = render();
  bind(root);
}

// ---------- SHEETS ----------
function empSheet(e) {
  const w = e ? can('dipendenti.modifica') : can('dipendenti.crea');   // può salvare i campi
  const canDelEmp = !!e && can('dipendenti.elimina');                  // può eliminare
  if (!w && !canDelEmp) return;   // difesa: nessuna azione consentita
  const cid = activeCompany();
  const colors = ['#4f8a76', '#5b83a6', '#8b7fa8', '#c2685f', '#c98a52', '#5a9aa0', '#b97fa0', '#7f9e6a'];
  openSheet(`
    <h2>${e ? (w ? 'Modifica dipendente' : 'Dettaglio dipendente') : 'Nuovo dipendente'}</h2>
    <div class="frow">
      <div class="field"><label>Nome *</label><input id="f_first" value="${esc(e?.firstName || '')}"></div>
      <div class="field"><label>Cognome *</label><input id="f_last" value="${esc(e?.lastName || '')}"></div>
    </div>
    <div class="field"><label>Mansione / qualifica</label><input id="f_role" value="${esc(e?.role || '')}" placeholder="Es. Operaio, Impiegata…"></div>
    <div class="field"><label>Tipo di contratto</label><input id="f_contract" value="${esc(e?.contract || '')}" placeholder="Es. Tempo indeterminato, Determinato, Apprendistato"></div>
    <div class="frow">
      <div class="field"><label>Inizio contratto</label><input id="f_cstart" type="date" value="${esc(e?.contractStart || '')}"></div>
      <div class="field"><label>Scadenza</label><input id="f_cend" type="date" value="${esc(e?.contractEnd || '')}"></div>
    </div>
    <div class="field"><label><input type="checkbox" id="f_copen" ${e?.contractOpen ? 'checked' : ''}> Tempo indeterminato (nessuna scadenza)</label></div>
    <div class="field"><label>🩺 Scadenza libretto sanitario</label><input id="f_libretto" type="date" value="${esc(e?.librettoSanitario || '')}"></div>
    <div class="frow">
      <div class="field"><label>🏖️ Ferie annue (giorni)</label><input id="f_ferie" inputmode="decimal" value="${e?.ferieAnnue ? esc(fmtDays(e.ferieAnnue)) : ''}" placeholder="Es. 26"></div>
      <div class="field"><label>📝 Permessi ROL annui (giorni)</label><input id="f_rol" inputmode="decimal" value="${e?.rolAnnui ? esc(fmtDays(e.rolAnnui)) : ''}" placeholder="Es. 8"></div>
    </div>
    <div class="field"><label>🔒 Nota privata (solo interna)</label><textarea id="f_noteprivate" rows="2" placeholder="Non compare in nessun export">${esc(e?.notePrivate || '')}</textarea></div>
    <div class="field"><label>📋 Nota per il consulente</label><textarea id="f_noteconsultant" rows="2" placeholder="Se compilata, viene allegata al PDF per il consulente">${esc(e?.noteConsultant || '')}</textarea></div>
    <div class="field"><label>Colore</label><div class="btnrow" id="f_colors">${colors.map(c => `<button data-color="${c}" style="width:26px;height:26px;border-radius:50%;background:${c};border:2px solid ${(e?.color || '#4f8a76') === c ? 'var(--txt)' : 'transparent'}"></button>`).join('')}</div></div>
    ${e ? `<div class="field"><label>Stato</label><select id="f_active"><option value="1" ${e.active !== false ? 'selected' : ''}>Attivo</option><option value="0" ${e.active === false ? 'selected' : ''}>Cessato</option></select></div>` : ''}
    <div class="actions">
      ${canDelEmp ? '<button class="btn danger" data-del>Elimina</button>' : ''}
      <button class="btn" data-cancel>${w ? 'Annulla' : 'Chiudi'}</button>
      ${w ? '<button class="btn primary" data-save>Salva</button>' : ''}
    </div>`, sheet => {
    let color = e?.color || '#4f8a76';
    if (!w) sheet.querySelectorAll('input, select, textarea, [data-color]').forEach(el => { el.disabled = true; el.style.pointerEvents = 'none'; });
    sheet.querySelectorAll('[data-color]').forEach(b => b.onclick = () => {
      color = b.dataset.color;
      sheet.querySelectorAll('[data-color]').forEach(x => x.style.borderColor = 'transparent');
      b.style.borderColor = 'var(--txt)';
    });
    // "Tempo indeterminato": disabilita e svuota la scadenza
    const copen = sheet.querySelector('#f_copen'), cend = sheet.querySelector('#f_cend');
    const syncCend = () => { cend.disabled = copen.checked || !w; if (copen.checked) cend.value = ''; cend.style.opacity = copen.checked ? '.5' : '1'; };
    copen.onchange = syncCend; syncCend();
    sheet.querySelector('[data-cancel]').onclick = closeSheet;
    sheet.querySelector('[data-save]')?.addEventListener('click', () => {
      const first = sheet.querySelector('#f_first').value.trim();
      const last = sheet.querySelector('#f_last').value.trim();
      if (!first && !last) { toast('Inserisci nome o cognome'); return; }
      const cOpen = sheet.querySelector('#f_copen').checked;
      const obj = {
        firstName: first, lastName: last, role: sheet.querySelector('#f_role').value.trim(), color,
        contract: sheet.querySelector('#f_contract').value.trim(),
        contractStart: sheet.querySelector('#f_cstart').value || '',
        contractOpen: cOpen,
        contractEnd: cOpen ? '' : (sheet.querySelector('#f_cend').value || ''),
        librettoSanitario: sheet.querySelector('#f_libretto').value || '',
        ferieAnnue: parseAmount(sheet.querySelector('#f_ferie').value) || 0,   // giorni/anno (0 = non configurato)
        rolAnnui: parseAmount(sheet.querySelector('#f_rol').value) || 0,        // giorni/anno (0 = non configurato)
        notePrivate: sheet.querySelector('#f_noteprivate').value.trim(),
        noteConsultant: sheet.querySelector('#f_noteconsultant').value.trim()
      };
      if (e) {
        Object.assign(e, obj);
        e.active = sheet.querySelector('#f_active').value === '1';
      } else {
        const ne = { id: uid(), companyId: cid, ...obj, active: true, createdAt: Date.now(), salaries: [], loans: [], attachments: [] };
        data.employees.push(ne);
        selectedId = ne.id;
      }
      save(); closeSheet(); rerender(); toast('Dipendente salvato ✓');
    });
    const del = sheet.querySelector('[data-del]');
    if (del) del.onclick = () => confirmDialog('Eliminare il dipendente?', 'Verranno rimosse anche tutte le presenze e voci collegate.', 'Elimina', () => {
      data.employees = data.employees.filter(x => x.id !== e.id);
      data.attendance = data.attendance.filter(a => a.employeeId !== e.id);
      data.entries = data.entries.filter(x => x.employeeId !== e.id);
      selectedId = null;
      save(); closeSheet(); rerender(); toast('Dipendente eliminato');
    }, { danger: true });
  });
}

function salarySheet(e) {
  const canSet = can('stipendi.crea');       // impostare il netto pattuito
  const canDelSal = can('stipendi.elimina');  // eliminare voci dello storico
  if (!canSet && !canDelSal) return;   // difesa: nessuna azione consentita
  const cur = salaryFor(e, month);
  const hist = (e.salaries || []).slice().sort((a, b) => b.month.localeCompare(a.month));
  openSheet(`
    <h2>Stipendio netto pattuito</h2>
    <div class="sheetsub">Imposta il netto valido <b>da</b> ${esc(fmtMonth(month))} in poi (storicizzato). I mesi precedenti mantengono il valore già impostato.</div>
    <div class="field"><label>Netto pattuito da ${esc(fmtMonth(month))}</label><input id="f_net" inputmode="decimal" value="${cur ? fmtNum(cur) : ''}" placeholder="0,00" ${canSet ? '' : 'disabled'}></div>
    ${hist.length ? `<div class="section-title" style="margin-top:6px">Storico</div><div class="list">${hist.map(s => `<div class="row"><div class="mid"><div class="t1">${esc(fmtMonth(s.month))}</div></div><div class="amt tnum">${fmt(s.net)}</div>${canDelSal ? `<button class="btn sm danger" data-delsal="${s.month}">✕</button>` : ''}</div>`).join('')}</div>` : ''}
    <div class="actions"><button class="btn" data-cancel>${canSet ? 'Annulla' : 'Chiudi'}</button>${canSet ? '<button class="btn primary" data-save>Salva</button>' : ''}</div>`, sheet => {
    sheet.querySelector('[data-cancel]').onclick = closeSheet;
    sheet.querySelector('[data-save]')?.addEventListener('click', () => {
      const v = parseAmount(sheet.querySelector('#f_net').value);
      if (v == null) { toast('Importo non valido'); return; }
      setSalary(e, month, v); save(); closeSheet(); rerender(); toast('Stipendio aggiornato ✓');
    });
    sheet.querySelectorAll('[data-delsal]').forEach(b => b.onclick = () => {
      e.salaries = e.salaries.filter(s => s.month !== b.dataset.delsal); save(); salarySheet(e);
    });
  });
}

function daySheet(e, ds) {
  const cell = attendanceCell(e, ds);
  const locked = isMonthLocked(e.companyId, month);                   // mese chiuso: sola lettura
  const w = (cell ? can('presenze.modifica') : can('presenze.crea')) && !locked;   // salva: modifica su giornata esistente, crea su giornata nuova
  const canClear = !!cell && can('presenze.elimina') && !locked;      // svuota giornata
  const certCanEdit = !!cell && can('presenze.modifica') && !locked;  // allegare/rimuovere il certificato
  const auto = Math.round(salaryFor(e, month) / 26 * 100) / 100; // trattenuta automatica permesso non retrib.
  openSheet(`
    <h2>${fmtDateFull(ds)}</h2>
    <div class="sheetsub">${w ? 'Seleziona lo stato della giornata. Per le assenze puoi indicare un importo da scalare dal netto.' : 'Dettaglio della giornata (sola lettura).'}</div>
    <div class="stpick" id="f_status">
      ${STATUS_ORDER.map(k => { const s = STATUSES[k]; const on = cell?.status === k; return `<button data-st="${k}" class="${on ? 'on' : ''}"><span class="dot" style="background:${s.color}"></span>${s.emoji} ${esc(s.label)}</button>`; }).join('')}
    </div>
    <div id="shiftwrap" style="display:none">
      <div class="field"><label>Turno</label>
        <div class="chips" id="f_shift">
          <button type="button" class="chip ${!cell?.shift ? 'on' : ''}" data-sh="">—</button>
          ${SHIFT_ORDER.map(k => `<button type="button" class="chip ${cell?.shift === k ? 'on' : ''}" data-sh="${k}">${SHIFTS[k].emoji} ${esc(SHIFTS[k].label)}</button>`).join('')}
        </div>
      </div>
      <div class="field"><label>Bonus turno (opzionale, si somma al netto)</label><input id="f_sbonus" inputmode="decimal" value="${cell?.shiftBonus ? fmtNum(cell.shiftBonus) : ''}" placeholder="0,00"></div>
    </div>
    <div class="field" id="amtwrap" style="${cell && STATUSES[cell.status]?.kind === 'absence' ? '' : 'display:none'}">
      <label id="amtlbl">Importo da scalare (opzionale)</label><input id="f_amt" inputmode="decimal" value="${cell?.amount ? fmtNum(cell.amount) : ''}" placeholder="0,00">
      <div class="muted" id="nrhint" style="font-size:12px;margin-top:4px;display:none">Automatico: netto pattuito ÷ 26 = <b>${fmtNum(auto)}</b>. Lascia vuoto per usarlo, oppure scrivi un importo per sovrascriverlo.</div>
    </div>
    <div class="field"><label>Nota</label><input id="f_note" value="${esc(cell?.note || '')}"></div>
    <div id="certblk">${certBlockHTML(cell, certCanEdit)}</div>
    <div class="actions">
      ${canClear ? '<button class="btn danger" data-clear>Svuota</button>' : ''}
      <button class="btn" data-cancel>${w ? 'Annulla' : 'Chiudi'}</button>
      ${w ? '<button class="btn primary" data-save>Salva</button>' : ''}
    </div>`, sheet => {
    let status = cell?.status || null;
    let shift = cell?.shift || null;
    const amtwrap = sheet.querySelector('#amtwrap'), shiftwrap = sheet.querySelector('#shiftwrap');
    const nrhint = sheet.querySelector('#nrhint'), amtlbl = sheet.querySelector('#amtlbl'), amtInput = sheet.querySelector('#f_amt');
    if (!w) sheet.querySelectorAll('input, textarea, [data-st], [data-sh]').forEach(el => { el.disabled = true; el.style.pointerEvents = 'none'; });
    // certificato (malattia/infortunio): aggiungi/apri/elimina sull'attendance record
    if (certEligible(cell)) bindAttachments(sheet, {
      getAtts: () => (cell.attachments ||= []),
      setAtts: arr => { cell.attachments = arr; },
      canEdit: certCanEdit, idPrefix: 'cert',
      onChange: () => { save(); refreshInPlace(e); daySheet(e, ds); },
    });
    const updateDyn = () => {
      const isAbs = STATUSES[status]?.kind === 'absence';
      amtwrap.style.display = isAbs ? '' : 'none';
      shiftwrap.style.display = status === 'present' ? '' : 'none';
      const isNR = status === 'permesso_nr';
      nrhint.style.display = isNR ? '' : 'none';
      amtInput.placeholder = isNR ? `auto ${fmtNum(auto)}` : '0,00';
      amtlbl.textContent = isNR ? 'Importo da scalare (vuoto = automatico)' : 'Importo da scalare (opzionale)';
    };
    sheet.querySelectorAll('[data-st]').forEach(b => b.onclick = () => {
      status = b.dataset.st;
      sheet.querySelectorAll('[data-st]').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      updateDyn();
    });
    sheet.querySelectorAll('#f_shift [data-sh]').forEach(b => b.onclick = () => {
      shift = b.dataset.sh || null;
      sheet.querySelectorAll('#f_shift .chip').forEach(c => c.classList.toggle('on', (c.dataset.sh || '') === (shift || '')));
    });
    updateDyn();
    sheet.querySelector('[data-cancel]').onclick = closeSheet;
    sheet.querySelector('[data-save]')?.addEventListener('click', () => {
      if (!status) { toast('Seleziona uno stato'); return; }
      const isPresent = status === 'present';
      const amt = STATUSES[status]?.kind === 'absence' ? (parseAmount(amtInput.value) || 0) : 0;
      const sBonus = isPresent ? (parseAmount(sheet.querySelector('#f_sbonus').value) || 0) : 0;
      const sShift = isPresent ? shift : null;
      const note = sheet.querySelector('#f_note').value.trim();
      const ex = data.attendance.find(a => a.employeeId === e.id && a.date === ds);
      if (ex) { ex.status = status; ex.amount = amt; ex.shift = sShift; ex.shiftBonus = sBonus; ex.note = note; }
      else data.attendance.push({ id: uid(), companyId: e.companyId, employeeId: e.id, date: ds, status, amount: amt, shift: sShift, shiftBonus: sBonus, note });
      save(); closeSheet(); rerender();
    });
    const clr = sheet.querySelector('[data-clear]');
    if (clr) clr.onclick = () => { data.attendance = data.attendance.filter(a => !(a.employeeId === e.id && a.date === ds)); save(); closeSheet(); rerender(); };
  });
}

function entrySheet(e, id) {
  const x = id ? data.entries.find(z => z.id === id) : null;
  const entLocked = x ? isMonthLocked(e.companyId, x.month) : false;   // voce in un mese chiuso: sola lettura
  const w = (x ? can('voci.modifica') : can('voci.crea')) && !entLocked;   // salva: modifica su voce esistente, crea su voce nuova
  const canDelV = !!x && can('voci.elimina') && !entLocked;             // elimina voce
  openSheet(`
    <h2>${x ? (w ? 'Modifica voce' : 'Dettaglio voce') : 'Nuova voce'}</h2>
    <div class="field"><label>Tipo</label><select id="f_kind">${Object.entries(ENTRY_KINDS).map(([k, v]) => `<option value="${k}" ${x?.kind === k ? 'selected' : ''}>${v.emoji} ${esc(v.label)}</option>`).join('')}</select></div>
    <div class="frow">
      <div class="field"><label>Importo *</label><input id="f_amt" inputmode="decimal" value="${x?.amount ? fmtNum(x.amount) : ''}" placeholder="0,00"></div>
      <div class="field"><label>Data</label><input id="f_date" type="date" value="${esc(x?.date || todayStr())}"></div>
    </div>
    <div class="field"><label>Descrizione</label><input id="f_desc" value="${esc(x?.desc || '')}" placeholder="Opzionale"></div>
    <div class="actions">
      ${canDelV ? '<button class="btn danger" data-del>Elimina</button>' : ''}
      <button class="btn" data-cancel>${w ? 'Annulla' : 'Chiudi'}</button>
      ${w ? '<button class="btn primary" data-save>Salva</button>' : ''}
    </div>`, sheet => {
    if (!w) sheet.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
    sheet.querySelector('[data-cancel]').onclick = closeSheet;
    sheet.querySelector('[data-save]')?.addEventListener('click', () => {
      const amt = parseAmount(sheet.querySelector('#f_amt').value);
      if (amt == null) { toast('Importo non valido'); return; }
      const date = sheet.querySelector('#f_date').value || todayStr();
      if (isMonthLocked(e.companyId, date.slice(0, 7))) { toast('Mese chiuso: voce non consentita'); return; }
      const obj = { kind: sheet.querySelector('#f_kind').value, amount: amt, date, month: date.slice(0, 7), desc: sheet.querySelector('#f_desc').value.trim() };
      if (x) Object.assign(x, obj);
      else data.entries.push({ id: uid(), companyId: e.companyId, employeeId: e.id, ...obj, createdAt: Date.now() });
      save(); closeSheet(); rerender(); toast('Voce salvata ✓');
    });
    const del = sheet.querySelector('[data-del]');
    if (del) del.onclick = () => { data.entries = data.entries.filter(z => z.id !== x.id); save(); closeSheet(); rerender(); toast('Voce eliminata'); };
  });
}

function loanSheet(e, id) {
  if (!can('prestiti.crea')) return;   // difesa: azione riservata
  openSheet(`
    <h2>Nuovo prestito</h2>
    <div class="sheetsub">Inserisci totale, numero rate e mese della prima rata: il piano viene generato in automatico (potrai poi modificare o saltare le singole rate).</div>
    <div class="field"><label>Nome / descrizione</label><input id="f_name" placeholder="Es. Anticipo TFR, prestito personale…"></div>
    <div class="frow">
      <div class="field"><label>Totale *</label><input id="f_total" inputmode="decimal" placeholder="0,00"></div>
      <div class="field"><label>N° rate *</label><input id="f_count" inputmode="numeric" placeholder="12"></div>
    </div>
    <div class="frow">
      <div class="field"><label>Prima rata (mese)</label><input id="f_start" type="month" value="${esc(month)}"></div>
      <div class="field"><label>Importo rata</label><input id="f_amt" inputmode="decimal" placeholder="auto"></div>
    </div>
    <div class="field"><label>Note</label><input id="f_notes" placeholder="Opzionale"></div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-save>Crea piano</button></div>`, sheet => {
    const totalEl = sheet.querySelector('#f_total'), countEl = sheet.querySelector('#f_count'), amtEl = sheet.querySelector('#f_amt');
    const syncAmt = () => { const t = parseAmount(totalEl.value), c = parseInt(countEl.value); if (t && c > 0 && !amtEl.dataset.touched) amtEl.placeholder = fmtNum(t / c); };
    totalEl.oninput = syncAmt; countEl.oninput = syncAmt;
    amtEl.oninput = () => amtEl.dataset.touched = '1';
    sheet.querySelector('[data-cancel]').onclick = closeSheet;
    sheet.querySelector('[data-save]').onclick = () => {
      const total = parseAmount(totalEl.value), count = parseInt(countEl.value);
      if (!total || !(count > 0)) { toast('Inserisci totale e numero rate'); return; }
      const start = sheet.querySelector('#f_start').value || month;
      const amount = parseAmount(amtEl.value) || Math.round(total / count * 100) / 100;
      const loan = { id: uid(), name: sheet.querySelector('#f_name').value.trim() || 'Prestito', total, count, startMonth: start, amount, notes: sheet.querySelector('#f_notes').value.trim(), createdAt: Date.now(), plan: buildLoanPlan(total, count, start, amount) };
      if (!Array.isArray(e.loans)) e.loans = [];
      e.loans.push(loan);
      save(); closeSheet(); rerender(); toast('Prestito creato ✓');
    };
  });
}

function loanDetailSheet(e, id) {
  const l = (e.loans || []).find(x => x.id === id);
  if (!l) return;
  const w = can('prestiti.modifica');     // segnare rate pagate/saltate
  const canDelL = can('prestiti.elimina'); // eliminare il prestito
  openSheet(`
    <h2>🏦 ${esc(l.name)}</h2>
    <div class="sheetsub">Residuo ${fmt(loanResiduo(l))} · pagato ${fmt(loanPaid(l))} di ${fmt(loanPaid(l) + loanResiduo(l))}${l.notes ? ' · ' + esc(l.notes) : ''}</div>
    <div class="list" style="max-height:48vh;overflow:auto">${(l.plan || []).map(r => `<div class="row">
      <div class="emoji">${r.skipped ? '⏭️' : r.status === 'paid' ? '✅' : '•'}</div>
      <div class="mid"><div class="t1">Rata ${r.n} · ${esc(fmtMonth(r.month))}</div><div class="t2">${r.skipped ? 'saltata' : r.status === 'paid' ? 'pagata' : 'da pagare'}</div></div>
      <div class="amt tnum">${fmt(r.amount)}</div>
      ${w ? `<button class="btn sm" data-pay="${r.n}">${r.status === 'paid' ? '↩︎' : '✓'}</button>
      <button class="btn sm" data-skip="${r.n}">${r.skipped ? '↩︎' : '⏭'}</button>` : ''}
    </div>`).join('')}</div>
    <div class="actions">${canDelL ? '<button class="btn danger" data-del>Elimina prestito</button>' : ''}<button class="btn primary" data-close>Chiudi</button></div>`, sheet => {
    sheet.querySelector('[data-close]').onclick = () => { closeSheet(); rerender(); };
    sheet.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => { const r = l.plan.find(x => x.n == b.dataset.pay); r.status = r.status === 'paid' ? 'pending' : 'paid'; save(); loanDetailSheet(e, id); });
    sheet.querySelectorAll('[data-skip]').forEach(b => b.onclick = () => { const r = l.plan.find(x => x.n == b.dataset.skip); r.skipped = !r.skipped; save(); loanDetailSheet(e, id); });
    sheet.querySelector('[data-del]')?.addEventListener('click', () => confirmDialog('Eliminare il prestito?', 'L\'intero piano rate verrà rimosso.', 'Elimina', () => {
      e.loans = e.loans.filter(x => x.id !== id); save(); closeSheet(); rerender(); toast('Prestito eliminato');
    }, { danger: true }));
  });
}

// apre direttamente un dipendente (usato dal Riepilogo)
export function openEmployee(id) { selectedId = id; }
export function setMonth(m) { month = m; }
export function getMonth() { return month; }
