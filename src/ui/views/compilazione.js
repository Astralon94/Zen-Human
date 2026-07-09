// ============ Vista Compilazione: matrice dipendenti × giorni ============
// Compilazione veloce di tutto il mese e di tutti i dipendenti in un'unica griglia.
import { data, save } from '../../state/store.js';
import { can } from '../../state/auth.js';
import { STATUS_ORDER, STATUSES, SHIFT_ORDER, SHIFTS } from '../../state/model.js';
import {
  esc, uid, fmt, fmtNum, parseAmount, fullName, initials, fmtMonth, shiftMonth,
  daysInMonth, weekdayMon0, pad2, todayStr, fmtDateFull, GIORNI, thisMonth
} from '../../domain/util.js';
import { activeCompany, co, emp, companyEmployees, attendanceCell, statusInfo, monthlyNet, salaryFor, cellDeduction } from '../../domain/payroll.js';
import { openSheet, closeSheet, toast } from '../dom.js';
import { getMonth, setMonth } from './dipendenti.js';

let brush = null; // null = Dettaglio; '__erase' = gomma; altrimenti chiave stato

export function render() {
  const cid = activeCompany();
  if (!cid) return `<div class="pagehead"><h1>Compilazione</h1></div><div class="card empty">Crea prima un'azienda dalla sezione Aziende.</div>`;
  const canWrite = can('presenze.manage');
  if (!canWrite) brush = null;   // sola lettura: nessun pennello, il tocco apre la scheda in lettura
  const month = getMonth();
  const emps = companyEmployees(cid);

  let h = `<div class="pagehead"><h1>Compilazione</h1><span class="sub">${esc((co(cid)?.emoji || '') + ' ' + co(cid)?.name)}</span></div>`;
  h += `<div class="card" style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
    <button class="btn sm" data-mprev>‹</button>
    <div style="flex:1;text-align:center;font-weight:700">${esc(fmtMonth(month))}</div>
    <button class="btn sm" data-mnext>›</button>
    <button class="btn sm" data-mtoday>Oggi</button>
  </div>`;

  if (!emps.length) { h += `<div class="card empty">Nessun dipendente attivo in questa azienda.</div>`; return h; }

  // barra pennello (solo con permesso di compilazione)
  if (canWrite) {
    const b = (key, label, title) => `<button class="chip ${(brush || '') === key ? 'on' : ''}" data-brush="${key}" title="${esc(title)}">${label}</button>`;
    h += `<div class="card" style="margin-bottom:8px">
      <div class="muted" style="font-size:12.5px;margin-bottom:8px">Scegli uno stato e tocca le celle per compilarle. In <b>Dettaglio</b> il tocco apre la scheda del singolo giorno (importi e note).</div>
      <div class="chips" style="margin:0">
        ${b('', '✏️ Dettaglio', 'Dettaglio: apre la scheda del giorno')}
        ${STATUS_ORDER.map(k => b(k, `${STATUSES[k].emoji} ${STATUSES[k].short}`, STATUSES[k].label)).join('')}
        ${b('__erase', '🧽 Gomma', 'Svuota la cella')}
      </div>
    </div>`;
  }

  h += `<div class="matrix-wrap ${brush !== null ? 'painting' : ''}" id="mwrap">${matrixHTML(emps, month)}</div>`;
  h += `<div class="legend">${STATUS_ORDER.map(k => { const s = STATUSES[k]; return `<span class="tag"><i style="background:${s.color}"></i>${s.emoji} ${esc(s.label)}</span>`; }).join('')}</div>`;
  return h;
}

function matrixHTML(emps, month) {
  const dim = daysInMonth(month);
  let head = `<th class="namecol">Dipendente</th>`;
  for (let d = 1; d <= dim; d++) {
    const ds = `${month}-${pad2(d)}`;
    const dow = weekdayMon0(ds);
    const wknd = dow >= 5;
    const today = ds === todayStr();
    head += `<th class="${wknd ? 'wknd' : ''}${today ? ' today' : ''}"><div class="dn">${d}</div><div class="dl">${GIORNI[dow][0]}</div></th>`;
  }
  head += `<th class="nettocol">Netto</th>`;

  const rows = emps.map(e => {
    let cells = `<td class="namecol"><div style="display:flex;align-items:center;gap:8px"><div class="avatar" style="width:26px;height:26px;font-size:11px;background:${esc(e.color || '#4f8a76')}">${esc(initials(e))}</div><div style="min-width:0"><div class="t1" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(fullName(e))}</div></div></div></td>`;
    for (let d = 1; d <= dim; d++) {
      const ds = `${month}-${pad2(d)}`;
      cells += cellHTML(e, ds);
    }
    cells += `<td class="nettocol" data-net="${e.id}">${fmt(monthlyNet(e, month).net)}</td>`;
    return `<tr>${cells}</tr>`;
  }).join('');

  // min-width: sotto questa soglia si scrolla; sopra, width:100% allarga le colonne per riempire lo schermo
  const minW = 170 + 96 + dim * 28;
  return `<table class="matrix" style="min-width:${minW}px"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function cellHTML(e, ds) {
  const cell = attendanceCell(e, ds);
  const wknd = weekdayMon0(ds) >= 5;
  if (cell) {
    const info = statusInfo(cell.status);
    const mark = (cellDeduction(e, getMonth(), cell) > 0 || cell.shiftBonus) ? '<sup>•</sup>' : '';
    return `<td class="mcell" data-emp="${e.id}" data-day="${ds}" style="background:${info.color};color:#fff">${info.short}${mark}</td>`;
  }
  return `<td class="mcell unset ${wknd ? 'wknd' : ''}" data-emp="${e.id}" data-day="${ds}"></td>`;
}

export function bind(root) {
  root.querySelector('[data-mprev]')?.addEventListener('click', () => { setMonth(shiftMonth(getMonth(), -1)); rerender(); });
  root.querySelector('[data-mnext]')?.addEventListener('click', () => { setMonth(shiftMonth(getMonth(), 1)); rerender(); });
  root.querySelector('[data-mtoday]')?.addEventListener('click', () => { setMonth(thisMonth()); rerender(); });
  if (!companyEmployees(activeCompany()).length) return;

  root.querySelectorAll('[data-brush]').forEach(b => b.onclick = () => {
    brush = b.dataset.brush ? b.dataset.brush : null;
    root.querySelectorAll('[data-brush]').forEach(x => x.classList.toggle('on', (x.dataset.brush || '') === (brush || '')));
    root.querySelector('#mwrap')?.classList.toggle('painting', brush !== null);
  });
  bindCells(root);
}

function bindCells(root) {
  root.querySelectorAll('td.mcell').forEach(td => td.onclick = () => {
    const e = emp(td.dataset.emp); const ds = td.dataset.day;
    if (!e) return;
    if (brush === null) dayEditor(e, ds, td);
    else paintCell(e, ds, td);
  });
}

function paintCell(e, ds, td) {
  if (!can('presenze.manage')) return;
  const month = getMonth();
  const ex = data.attendance.find(a => a.employeeId === e.id && a.date === ds);
  if (brush === '__erase') {
    if (ex) data.attendance = data.attendance.filter(a => a !== ex);
  } else {
    const isAbs = STATUSES[brush]?.kind === 'absence';
    if (ex) { const same = ex.status === brush; ex.status = brush; ex.amount = isAbs ? (same ? ex.amount || 0 : 0) : 0; if (brush !== 'present') { ex.shift = null; ex.shiftBonus = 0; } }
    else data.attendance.push({ id: uid(), companyId: e.companyId, employeeId: e.id, date: ds, status: brush, amount: 0, shift: null, shiftBonus: 0, note: '' });
  }
  save();
  replaceCell(td, e, ds);
  updateNetto(e, month);
}

// sostituisce una cella in-place (niente rerender dell'intera matrice)
function replaceCell(td, e, ds) {
  const tmp = document.createElement('tbody');
  tmp.innerHTML = `<tr>${cellHTML(e, ds)}</tr>`;
  const fresh = tmp.querySelector('td');
  fresh.onclick = () => { if (brush === null) dayEditor(e, ds, fresh); else paintCell(e, ds, fresh); };
  td.replaceWith(fresh);
}
function updateNetto(e, month) {
  const cell = document.querySelector(`[data-net="${e.id}"]`);
  if (cell) cell.textContent = fmt(monthlyNet(e, month).net);
}

// editor compatto del singolo giorno (modalità Dettaglio)
function dayEditor(e, ds, td) {
  const cell = attendanceCell(e, ds);
  const w = can('presenze.manage');
  const auto = Math.round(salaryFor(e, getMonth()) / 26 * 100) / 100;
  openSheet(`
    <h2>${esc(fullName(e))}</h2>
    <div class="sheetsub">${fmtDateFull(ds)} · ${w ? 'seleziona lo stato. Per le assenze puoi indicare un importo da scalare dal netto.' : 'dettaglio della giornata (sola lettura).'}</div>
    <div class="stpick">
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
    <div class="actions">
      ${cell && w ? '<button class="btn danger" data-clear>Svuota</button>' : ''}
      <button class="btn" data-cancel>${w ? 'Annulla' : 'Chiudi'}</button>
      ${w ? '<button class="btn primary" data-save>Salva</button>' : ''}
    </div>`, sheet => {
    let status = cell?.status || null;
    let shift = cell?.shift || null;
    const amtwrap = sheet.querySelector('#amtwrap'), shiftwrap = sheet.querySelector('#shiftwrap');
    const nrhint = sheet.querySelector('#nrhint'), amtlbl = sheet.querySelector('#amtlbl'), amtInput = sheet.querySelector('#f_amt');
    const updateDyn = () => {
      amtwrap.style.display = STATUSES[status]?.kind === 'absence' ? '' : 'none';
      shiftwrap.style.display = status === 'present' ? '' : 'none';
      const isNR = status === 'permesso_nr';
      nrhint.style.display = isNR ? '' : 'none';
      amtInput.placeholder = isNR ? `auto ${fmtNum(auto)}` : '0,00';
      amtlbl.textContent = isNR ? 'Importo da scalare (vuoto = automatico)' : 'Importo da scalare (opzionale)';
    };
    if (!w) sheet.querySelectorAll('input, textarea, [data-st], [data-sh]').forEach(el => { el.disabled = true; el.style.pointerEvents = 'none'; });
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
      save(); closeSheet(); replaceCell(td, e, ds); updateNetto(e, getMonth());
    });
    const clr = sheet.querySelector('[data-clear]');
    if (clr) clr.onclick = () => { data.attendance = data.attendance.filter(a => !(a.employeeId === e.id && a.date === ds)); save(); closeSheet(); replaceCell(td, e, ds); updateNetto(e, getMonth()); };
  });
}

function rerender() {
  const root = document.getElementById('view');
  root.innerHTML = render();
  bind(root);
}
