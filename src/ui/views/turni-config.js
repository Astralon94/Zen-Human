// ============ Configurazione Turni (sezione dentro Impostazioni) ============
// Tipi di turno e ruoli vivono nel doc dell'AZIENDA attiva (company.shiftTypes / company.roles).
// Gate: impostazioni.manage. Editing inline in stile Zen-Human (righe + sheet). L'eliminazione
// di un tipo di turno / ruolo in uso è BLOCCATA (nessuna cancellazione a cascata sui fatti).
import { data, save } from '../../state/store.js';
import { esc, uid } from '../../domain/util.js';
import { co, activeCompany } from '../../domain/payroll.js';
import { companyShiftTypes, companyRoles } from '../../state/model.js';
import { injectShiftScale, shiftBg, shiftFg } from '../shiftcolors.js';
import { openSheet, closeSheet, confirmDialog, toast } from '../dom.js';

// Sezione HTML da incorporare nelle Impostazioni (un contenitore ri-renderizzabile in autonomia).
export function turniConfigSection() {
  return `<div class="section-title">Turni</div><div id="turniCfg">${innerHTML()}</div>`;
}

function innerHTML() {
  const cid = activeCompany();
  const c = cid ? co(cid) : null;
  if (!c) return `<div class="card empty">Crea o seleziona un'azienda per configurare turni e ruoli.</div>`;
  injectShiftScale(c);
  const shifts = companyShiftTypes(c);
  const roles = companyRoles(c);
  const n = shifts.length;

  // ---- Tipi di turno ----
  let h = `<div class="card">
    <div class="cfg-head"><b>Tipi di turno</b><span class="grow"></span><button class="btn sm primary" data-newshift>+ Aggiungi</button></div>
    <div class="muted" style="font-size:12.5px;margin:4px 0 10px">L'ordine determina le righe della griglia e la scala di verdi (dal chiaro allo scuro).</div>
    <div class="cfg-list">${shifts.map((t, i) => shiftRow(t, i, n)).join('')}</div>
  </div>`;

  // ---- Ruoli ----
  h += `<div class="card" style="margin-top:12px">
    <div class="cfg-head"><b>Ruoli</b><span class="grow"></span><button class="btn sm primary" data-newrole>+ Aggiungi</button></div>
    <div class="muted" style="font-size:12.5px;margin:4px 0 10px">L'ordine determina le colonne della griglia Turni. L'acronimo (max 4) compare quando la colonna è stretta.</div>
    ${roles.length
      ? `<div class="cfg-list">${roles.map((r, i) => roleRow(r, i, roles.length)).join('')}</div>`
      : `<div class="empty" style="padding:20px">Nessun ruolo. Aggiungine almeno uno per usare la griglia Turni.</div>`}
  </div>`;
  return h;
}

function arrows(kind, id, i, len) {
  return `<button class="btn sm" data-up="${kind}:${id}" ${i === 0 ? 'disabled' : ''} title="Su">↑</button>
    <button class="btn sm" data-down="${kind}:${id}" ${i === len - 1 ? 'disabled' : ''} title="Giù">↓</button>`;
}

function shiftRow(t, i, n) {
  const sw = `background:${shiftBg(i, n)};color:${shiftFg(i, n)}`;
  return `<div class="cfg-row">
    <span class="cfg-swatch" style="${sw}" title="Gradazione ${i + 1} di ${n}">${i + 1}</span>
    <div class="cfg-mid"><div class="t1">${esc(t.name)}</div><div class="t2">${esc(t.start || '—')} – ${esc(t.end || '—')}</div></div>
    ${arrows('shift', t.id, i, n)}
    <button class="btn sm" data-editshift="${t.id}">Modifica</button>
    <button class="btn sm danger" data-delshift="${t.id}">Elimina</button>
  </div>`;
}

function roleRow(r, i, len) {
  return `<div class="cfg-row">
    <span class="cfg-acr">${esc(r.acronym || r.name.slice(0, 4).toUpperCase())}</span>
    <div class="cfg-mid"><div class="t1">${esc(r.name)}</div></div>
    ${arrows('role', r.id, i, len)}
    <button class="btn sm" data-editrole="${r.id}">Modifica</button>
    <button class="btn sm danger" data-delrole="${r.id}">Elimina</button>
  </div>`;
}

export function bindTurniConfig(root) {
  const container = root.querySelector('#turniCfg');
  if (!container) return;
  const cid = activeCompany();
  const c = cid ? co(cid) : null;
  if (!c) return;
  const rerender = () => { container.innerHTML = innerHTML(); bindTurniConfig(root); };

  // ---- Tipi di turno ----
  container.querySelector('[data-newshift]')?.addEventListener('click', () => editShift(c, null, rerender));
  container.querySelectorAll('[data-editshift]').forEach(b => b.onclick = () => editShift(c, b.dataset.editshift, rerender));
  container.querySelectorAll('[data-delshift]').forEach(b => b.onclick = () => delShift(c, b.dataset.delshift, rerender));
  // ---- Ruoli ----
  container.querySelector('[data-newrole]')?.addEventListener('click', () => editRole(c, null, rerender));
  container.querySelectorAll('[data-editrole]').forEach(b => b.onclick = () => editRole(c, b.dataset.editrole, rerender));
  container.querySelectorAll('[data-delrole]').forEach(b => b.onclick = () => delRole(c, b.dataset.delrole, rerender));
  // ---- Riordino (frecce) ----
  container.querySelectorAll('[data-up]').forEach(b => b.onclick = () => move(c, b.dataset.up, -1, rerender));
  container.querySelectorAll('[data-down]').forEach(b => b.onclick = () => move(c, b.dataset.down, 1, rerender));
}

function listOf(c, kind) { return kind === 'shift' ? (c.shiftTypes ||= []) : (c.roles ||= []); }

function move(c, ref, dir, rerender) {
  const [kind, id] = ref.split(':');
  const arr = listOf(c, kind);
  const i = arr.findIndex(x => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
  save(); rerender();
}

// ---- Editing tipo di turno ----
function editShift(c, id, rerender) {
  const t = id ? (c.shiftTypes || []).find(x => x.id === id) : null;
  openSheet(`
    <h2>${t ? 'Modifica tipo di turno' : 'Nuovo tipo di turno'}</h2>
    <div class="field"><label>Nome *</label><input id="s_name" value="${esc(t?.name || '')}" placeholder="Es. Mattina"></div>
    <div class="frow">
      <div class="field"><label>Inizio</label><input type="time" id="s_start" value="${esc(t?.start || '')}"></div>
      <div class="field"><label>Fine</label><input type="time" id="s_end" value="${esc(t?.end || '')}"></div>
    </div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-save>Salva</button></div>`,
    sheet => {
      sheet.querySelector('[data-cancel]').onclick = closeSheet;
      sheet.querySelector('[data-save]').onclick = () => {
        const name = sheet.querySelector('#s_name').value.trim();
        if (!name) { toast('Inserisci il nome'); return; }
        const start = sheet.querySelector('#s_start').value || '';
        const end = sheet.querySelector('#s_end').value || '';
        if (t) Object.assign(t, { name, start, end });
        else (c.shiftTypes ||= []).push({ id: uid(), name, start, end });
        save(); closeSheet(); rerender(); toast('Tipo di turno salvato ✓');
      };
    });
}

function delShift(c, id, rerender) {
  const arr = c.shiftTypes || [];
  if (arr.length <= 1) { toast('Deve restare almeno un tipo di turno'); return; }
  const used = data.attendance.filter(a => a.companyId === c.id && a.shift === id).length;
  if (used) { toast(`Impossibile eliminare: ${used} presenz${used === 1 ? 'a usa' : 'e usano'} questo turno`); return; }
  const t = arr.find(x => x.id === id);
  confirmDialog('Eliminare il tipo di turno?', `«${t?.name || ''}» verrà rimosso.`, 'Elimina', () => {
    c.shiftTypes = arr.filter(x => x.id !== id); save(); rerender(); toast('Tipo di turno eliminato');
  }, { danger: true });
}

// ---- Editing ruolo ----
function editRole(c, id, rerender) {
  const r = id ? (c.roles || []).find(x => x.id === id) : null;
  openSheet(`
    <h2>${r ? 'Modifica ruolo' : 'Nuovo ruolo'}</h2>
    <div class="frow">
      <div class="field"><label>Nome *</label><input id="r_name" value="${esc(r?.name || '')}" placeholder="Es. Banconista"></div>
      <div class="field" style="max-width:120px"><label>Acronimo</label><input id="r_acr" value="${esc(r?.acronym || '')}" maxlength="4" placeholder="Auto"></div>
    </div>
    <div class="actions"><button class="btn" data-cancel>Annulla</button><button class="btn primary" data-save>Salva</button></div>`,
    sheet => {
      const acr = sheet.querySelector('#r_acr');
      acr.oninput = () => { acr.value = acr.value.toUpperCase().slice(0, 4); };
      sheet.querySelector('[data-cancel]').onclick = closeSheet;
      sheet.querySelector('[data-save]').onclick = () => {
        const name = sheet.querySelector('#r_name').value.trim();
        if (!name) { toast('Inserisci il nome'); return; }
        const acronym = (acr.value.trim() || name.slice(0, 4)).toUpperCase().slice(0, 4);
        if (r) Object.assign(r, { name, acronym });
        else (c.roles ||= []).push({ id: uid(), name, acronym });
        save(); closeSheet(); rerender(); toast('Ruolo salvato ✓');
      };
    });
}

function delRole(c, id, rerender) {
  const used = data.attendance.filter(a => a.companyId === c.id && a.roleId === id).length;
  if (used) { toast(`Impossibile eliminare: ${used} presenz${used === 1 ? 'a usa' : 'e usano'} questo ruolo`); return; }
  const r = (c.roles || []).find(x => x.id === id);
  confirmDialog('Eliminare il ruolo?', `«${r?.name || ''}» verrà rimosso.`, 'Elimina', () => {
    c.roles = (c.roles || []).filter(x => x.id !== id); save(); rerender(); toast('Ruolo eliminato');
  }, { danger: true });
}
