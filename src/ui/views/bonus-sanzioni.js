// ============ Vista Bonus e sanzioni: inserimento rapido + storico data/ora ============
// Gestisce le voci economiche di tipo "bonus" e "sanction", collegate alle schede dipendenti
// (sono le stesse `data.entries` che compaiono nelle "Voci del mese" del dipendente).
import { data, save } from '../../state/store.js';
import { ENTRY_KINDS } from '../../state/model.js';
import { esc, uid, fmt, fmtNum, parseAmount, fullName, fmtDateFull, todayStr, pad2, round2 } from '../../domain/util.js';
import { activeCompany, co, emp, companyEmployees, entryInfo } from '../../domain/payroll.js';
import { openSheet, closeSheet, confirmDialog, toast } from '../dom.js';

const KINDS = ['bonus', 'sanction', 'advance'];   // bonus, sanzioni e acconti
let fKind = 'all';                                // 'all' | 'bonus' | 'sanction' | 'advance'

// timestamp di inserimento → "23/06/2026 14:05"
function fmtTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function scopeEntries(cid) {
  return data.entries
    .filter(x => x.companyId === cid && KINDS.includes(x.kind))
    .filter(x => fKind === 'all' || x.kind === fKind)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || (b.date || '').localeCompare(a.date || ''));
}

export function render() {
  const cid = activeCompany();
  if (!cid) return `<div class="pagehead"><h1>Voci economiche</h1></div><div class="card empty">Crea prima un'azienda dalla sezione Aziende.</div>`;
  const emps = companyEmployees(cid, { includeInactive: true });

  let h = `<div class="pagehead"><h1>Voci economiche</h1><span class="sub">${esc((co(cid)?.emoji || '') + ' ' + co(cid)?.name)}</span><span class="grow"></span>
    <button class="btn primary" data-new ${emps.length ? '' : 'disabled'}>+ Nuovo</button></div>`;

  if (!emps.length) { h += `<div class="card empty">Nessun dipendente in questa azienda. Aggiungine uno per registrare bonus o sanzioni.</div>`; return h; }

  const all = data.entries.filter(x => x.companyId === cid && KINDS.includes(x.kind));
  const sumOf = k => round2(all.filter(x => x.kind === k).reduce((s, x) => s + (Number(x.amount) || 0), 0));
  h += `<div class="grid k3" style="margin-bottom:8px">
    <div class="card kpi"><div class="lbl">➕ Bonus totali</div><div class="val tnum pos">${fmt(sumOf('bonus'))}</div></div>
    <div class="card kpi"><div class="lbl">⚠️ Sanzioni totali</div><div class="val tnum neg">${fmt(sumOf('sanction'))}</div></div>
    <div class="card kpi"><div class="lbl">💶 Acconti totali</div><div class="val tnum neg">${fmt(sumOf('advance'))}</div></div>
  </div>`;

  const chip = (v, l) => `<button class="chip ${fKind === v ? 'on' : ''}" data-k="${v}">${l}</button>`;
  h += `<div class="chips">${chip('all', 'Tutti')}${chip('bonus', '➕ Bonus')}${chip('sanction', '⚠️ Sanzioni')}${chip('advance', '💶 Acconti')}</div>`;

  const list = scopeEntries(cid);
  h += `<div class="section-title">Storico</div>`;
  if (!list.length) { h += `<div class="card empty">Nessuna voce registrata.</div>`; return h; }
  h += `<div class="list">${list.map(x => {
    const info = entryInfo(x.kind);
    const e = emp(x.employeeId);
    const cls = info.sign > 0 ? 'pos' : 'neg';
    return `<div class="row click" data-entry="${x.id}">
      <div class="emoji">${info.emoji}</div>
      <div class="mid"><div class="t1">${esc(e ? fullName(e) : 'Dipendente rimosso')}${x.desc ? ' · ' + esc(x.desc) : ''}</div>
        <div class="t2">${esc(info.label)} · ${x.date ? fmtDateFull(x.date) : ''}${x.createdAt ? ' · ins. ' + fmtTs(x.createdAt) : ''}</div></div>
      <div class="amt tnum ${cls}">${info.sign > 0 ? '+' : '−'} ${fmt(x.amount)}</div>
    </div>`;
  }).join('')}</div>`;
  return h;
}

export function bind(root) {
  root.querySelector('[data-new]')?.addEventListener('click', () => entrySheet(null));
  root.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { fKind = b.dataset.k; rerender(); });
  root.querySelectorAll('[data-entry]').forEach(b => b.onclick = () => entrySheet(b.dataset.entry));
}

function rerender() { const root = document.getElementById('view'); root.innerHTML = render(); bind(root); }

function entrySheet(id) {
  const cid = activeCompany();
  const x = id ? data.entries.find(z => z.id === id) : null;
  const emps = companyEmployees(cid, { includeInactive: true });
  openSheet(`
    <h2>${x ? 'Modifica voce' : 'Nuovo bonus / sanzione'}</h2>
    <div class="field"><label>Dipendente *</label><select id="f_emp">${emps.map(e => `<option value="${e.id}" ${x?.employeeId === e.id ? 'selected' : ''}>${esc(fullName(e))}${e.active === false ? ' (cessato)' : ''}</option>`).join('')}</select></div>
    <div class="field"><label>Tipo</label><div class="chips" id="f_kind">
      ${KINDS.map(k => `<button type="button" class="chip ${ (x?.kind || 'bonus') === k ? 'on' : ''}" data-kk="${k}">${ENTRY_KINDS[k].emoji} ${esc(ENTRY_KINDS[k].label)}</button>`).join('')}
    </div></div>
    <div class="frow">
      <div class="field"><label>Importo *</label><input id="f_amt" inputmode="decimal" value="${x?.amount ? fmtNum(x.amount) : ''}" placeholder="0,00"></div>
      <div class="field"><label>Data</label><input id="f_date" type="date" value="${esc(x?.date || todayStr())}"></div>
    </div>
    <div class="field"><label>Descrizione</label><input id="f_desc" value="${esc(x?.desc || '')}" placeholder="Opzionale (es. motivo)"></div>
    <div class="actions">
      ${x ? '<button class="btn danger" data-del>Elimina</button>' : ''}
      <button class="btn" data-cancel>Annulla</button>
      <button class="btn primary" data-save>Salva</button>
    </div>`, sheet => {
    let kind = x?.kind || 'bonus';
    sheet.querySelectorAll('#f_kind [data-kk]').forEach(b => b.onclick = () => {
      kind = b.dataset.kk;
      sheet.querySelectorAll('#f_kind .chip').forEach(c => c.classList.toggle('on', c.dataset.kk === kind));
    });
    sheet.querySelector('[data-cancel]').onclick = closeSheet;
    sheet.querySelector('[data-save]').onclick = () => {
      const empId = sheet.querySelector('#f_emp').value;
      if (!empId) { toast('Seleziona un dipendente'); return; }
      const amt = parseAmount(sheet.querySelector('#f_amt').value);
      if (amt == null) { toast('Importo non valido'); return; }
      const date = sheet.querySelector('#f_date').value || todayStr();
      const obj = { employeeId: empId, kind, amount: amt, date, month: date.slice(0, 7), desc: sheet.querySelector('#f_desc').value.trim() };
      if (x) Object.assign(x, obj);
      else data.entries.push({ id: uid(), companyId: cid, ...obj, createdAt: Date.now() });
      save(); closeSheet(); rerender(); toast('Voce salvata ✓');
    };
    const del = sheet.querySelector('[data-del]');
    if (del) del.onclick = () => confirmDialog('Eliminare la voce?', 'Verrà rimossa anche dalla scheda del dipendente.', 'Elimina', () => {
      data.entries = data.entries.filter(z => z.id !== x.id); save(); closeSheet(); rerender(); toast('Voce eliminata');
    }, { danger: true });
  });
}
