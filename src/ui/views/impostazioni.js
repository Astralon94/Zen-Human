// ============ Vista Impostazioni ============
import { data, save, setData, exportJSON, importJSON } from '../../state/store.js';
import { DEFAULT_DATA } from '../../state/model.js';
import { esc } from '../../domain/util.js';
import { toast, confirmDialog } from '../dom.js';
import { applyTheme } from '../app.js';
import { companiesSection, bindCompanies } from './aziende.js';

const APP_BUILD = '0.2.4';

export function render() {
  const t = data.settings.theme || 'auto';
  const opt = (v, l) => `<button class="chip ${t === v ? 'on' : ''}" data-th="${v}">${l}</button>`;
  let h = `<div class="pagehead"><h1>Impostazioni</h1></div>`;

  // gestione aziende (spostata qui dal menu)
  h += companiesSection();

  h += `<div class="section-title">Aspetto</div>`;
  h += `<div class="chips">${opt('auto', 'Automatico')}${opt('light', 'Chiaro')}${opt('dark', 'Scuro')}</div>`;

  h += `<div class="section-title">Backup</div>`;
  h += `<div class="card">
    <div class="muted" style="font-size:13px;margin-bottom:10px">I dati sono salvati nel <b>database locale</b> del server (con backup automatici lato server). Puoi comunque esportare o importare un backup completo in formato <b>JSON</b> — utile anche per trasferire i dati dalla vecchia versione.</div>
    <div class="btnrow">
      <button class="btn" data-export>Esporta backup (JSON)</button>
      <button class="btn" data-import>Importa backup (JSON)…</button>
      <input type="file" id="imp_file" accept="application/json,.json" style="display:none">
    </div>
  </div>`;

  h += `<div class="section-title">Archivio</div>`;
  h += `<div class="card">
    <table class="tbl">
      <tr><td>Aziende</td><td class="r tnum">${data.companies.length}</td></tr>
      <tr><td>Dipendenti</td><td class="r tnum">${data.employees.length}</td></tr>
      <tr><td>Giorni presenza registrati</td><td class="r tnum">${data.attendance.length}</td></tr>
      <tr><td>Voci (bonus/sanzioni/acconti)</td><td class="r tnum">${data.entries.length}</td></tr>
      <tr><td>Revisione salvataggio</td><td class="r tnum">#${data.rev || 0}</td></tr>
    </table>
  </div>`;

  h += `<div class="section-title">Zona pericolosa</div>`;
  h += `<div class="card"><button class="btn danger" data-wipe>Cancella tutti i dati</button></div>`;

  h += `<div class="muted" style="text-align:center;font-size:12px;margin-top:24px">Zen Human · v${APP_BUILD} · server locale</div>`;
  return h;
}

export function bind(root) {
  bindCompanies(root);
  root.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { data.settings.theme = b.dataset.th; save(); applyTheme(); });
  root.querySelector('[data-export]')?.addEventListener('click', () => { exportJSON(); toast('Backup esportato ✓'); });
  const impFile = root.querySelector('#imp_file');
  root.querySelector('[data-import]')?.addEventListener('click', () => impFile?.click());
  if (impFile) impFile.onchange = () => {
    const f = impFile.files[0]; impFile.value = '';
    if (!f) return;
    confirmDialog('Importare questo backup?', 'I dati attuali verranno sostituiti con quelli del file. Ne viene comunque tenuto un backup del database lato server.', 'Importa', async () => {
      try { await importJSON(f); toast('Backup importato ✓'); }
      catch (e) { toast('File non valido: ' + (e.message || 'errore')); }
    }, { danger: true });
  };

  root.querySelector('[data-wipe]').onclick = () => confirmDialog('Cancellare tutti i dati?', 'Operazione irreversibile. Esporta prima un backup.', 'Continua', () => {
    confirmDialog('Sei davvero sicuro?', 'Tutte le aziende, dipendenti, presenze e voci verranno eliminati.', 'Cancella tutto', () => {
      setData(DEFAULT_DATA()); toast('Dati cancellati');
    }, { danger: true });
  }, { danger: true });
}
