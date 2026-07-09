// ============ Gestione Aziende (sezione dentro Impostazioni) ============
import { data, save } from '../../state/store.js';
import { can } from '../../state/auth.js';
import { esc, uid } from '../../domain/util.js';
import { companyEmployees } from '../../domain/payroll.js';
import { openSheet, closeSheet, confirmDialog, toast } from '../dom.js';

// Sezione HTML da incorporare nelle Impostazioni
export function companiesSection() {
  let h = `<div class="section-title">Aziende<span class="grow"></span><button class="btn sm primary" data-newco>+ Nuova</button></div>`;
  if (!data.companies.length) {
    h += `<div class="card empty">Nessuna azienda.<br><button class="btn primary sm" data-newco style="margin-top:10px">Crea la prima</button></div>`;
    return h;
  }
  h += `<div class="list">${data.companies.map(rowHtml).join('')}</div>`;
  return h;
}

function rowHtml(c) {
  const n = companyEmployees(c.id, { includeInactive: true }).length;
  return `<div class="row click" data-editco="${c.id}">
    <div class="emoji">${esc(c.emoji || '🏢')}</div>
    <div class="mid"><div class="t1">${esc(c.name)}</div>
      <div class="t2">${c.piva ? 'P.IVA ' + esc(c.piva) + ' · ' : ''}${n} dipendent${n === 1 ? 'e' : 'i'}</div></div>
    <div class="muted">›</div>
  </div>`;
}

export function bindCompanies(root) {
  root.querySelectorAll('[data-newco]').forEach(b => b.onclick = () => editSheet(null));
  root.querySelectorAll('[data-editco]').forEach(b => b.onclick = () => editSheet(b.dataset.editco));
}

function editSheet(id) {
  if (!can('aziende.manage')) return;   // difesa: la sezione è già gated in Impostazioni
  const c = id ? data.companies.find(x => x.id === id) : null;
  openSheet(`
    <h2>${c ? 'Modifica azienda' : 'Nuova azienda'}</h2>
    <div class="frow">
      <div class="field" style="max-width:90px"><label>Emoji</label><input id="f_emoji" value="${esc(c?.emoji || '🏢')}" maxlength="4"></div>
      <div class="field"><label>Nome *</label><input id="f_name" value="${esc(c?.name || '')}" placeholder="Ragione sociale"></div>
    </div>
    <div class="frow">
      <div class="field"><label>P. IVA</label><input id="f_piva" value="${esc(c?.piva || '')}"></div>
      <div class="field"><label>Cod. fiscale</label><input id="f_cf" value="${esc(c?.cf || '')}"></div>
    </div>
    <div class="field"><label>Note</label><textarea id="f_note" rows="2">${esc(c?.note || '')}</textarea></div>
    <div class="actions">
      ${c ? '<button class="btn danger" data-del>Elimina</button>' : ''}
      <button class="btn" data-cancel>Annulla</button>
      <button class="btn primary" data-save>Salva</button>
    </div>`, sheet => {
    sheet.querySelector('[data-cancel]').onclick = closeSheet;
    sheet.querySelector('[data-save]').onclick = () => {
      const name = sheet.querySelector('#f_name').value.trim();
      if (!name) { toast('Inserisci il nome'); return; }
      const obj = {
        emoji: sheet.querySelector('#f_emoji').value.trim() || '🏢',
        name,
        piva: sheet.querySelector('#f_piva').value.trim(),
        cf: sheet.querySelector('#f_cf').value.trim(),
        note: sheet.querySelector('#f_note').value.trim()
      };
      if (c) Object.assign(c, obj);
      else {
        const nc = { id: uid(), color: '#4f8a76', ...obj };
        data.companies.push(nc);
        if (!data.settings.activeCompany) data.settings.activeCompany = nc.id;
      }
      save(); closeSheet(); toast('Azienda salvata ✓');
    };
    const del = sheet.querySelector('[data-del]');
    if (del) del.onclick = () => {
      const n = companyEmployees(c.id, { includeInactive: true }).length;
      confirmDialog('Eliminare l\'azienda?', n ? `Verranno eliminati anche ${n} dipendenti con tutte le presenze e voci collegate.` : 'L\'azienda verrà rimossa.', 'Elimina', () => {
        const empIds = new Set(data.employees.filter(e => e.companyId === c.id).map(e => e.id));
        data.employees = data.employees.filter(e => e.companyId !== c.id);
        data.attendance = data.attendance.filter(a => !empIds.has(a.employeeId));
        data.entries = data.entries.filter(x => !empIds.has(x.employeeId));
        data.companies = data.companies.filter(x => x.id !== c.id);
        if (data.settings.activeCompany === c.id) data.settings.activeCompany = data.companies[0]?.id || null;
        save(); closeSheet(); toast('Azienda eliminata');
      }, { danger: true });
    };
  });
}
