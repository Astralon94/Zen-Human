// ============ Vista Impostazioni ============
import { data, save, setData, exportJSON, importJSON } from '../../state/store.js';
import { DEFAULT_DATA } from '../../state/model.js';
import { esc, fmtDateFull } from '../../domain/util.js';
import { toast, confirmDialog } from '../dom.js';
import { applyTheme } from '../app.js';
import { companiesSection, bindCompanies } from './aziende.js';

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

  h += `<div class="section-title">Aggiornamento software</div>`;
  h += `<div class="card">
    <div class="muted" style="font-size:13px;margin-bottom:10px">Gli aggiornamenti vengono scaricati da <b>GitHub</b> e installati senza toccare i dati (la cartella <b>data/</b> non viene mai modificata). Il controllo è automatico all'avvio e ogni 12 ore; al termine dell'installazione il server si riavvia da solo.</div>
    <div class="muted" id="upd_stato" style="font-size:13px;margin-bottom:10px">Versione installata: …</div>
    <div class="btnrow">
      <button class="btn" data-updcheck>Controlla ora</button>
      <button class="btn" data-updinstall style="display:none">Installa e riavvia</button>
    </div>
  </div>`;

  h += `<div class="section-title">Zona pericolosa</div>`;
  h += `<div class="card"><button class="btn danger" data-wipe>Cancella tutti i dati</button></div>`;

  h += `<div class="muted" style="text-align:center;font-size:12px;margin-top:24px">Zen Human · <span id="app_ver">v…</span> · server locale</div>`;
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

  // Aggiornamento software: stato, controllo manuale, installazione con riavvio
  const updStato = root.querySelector('#upd_stato'), updVer = root.querySelector('#app_ver');
  const updCheckBtn = root.querySelector('[data-updcheck]'), updInstBtn = root.querySelector('[data-updinstall]');
  const showUpd = (s) => {
    if (!updStato || !s) return;
    if (updVer && s.corrente) updVer.textContent = 'v' + s.corrente;
    let txt = `Versione installata: <b>v${esc(s.corrente || '?')}</b>`;
    if (s.disponibile) txt += ` · disponibile <b>v${esc(s.ultima)}</b>${s.note ? ' — ' + esc(s.note) : ''}`;
    else if (s.controllato_il) txt += ' · aggiornata (ultimo controllo: ' + fmtDateFull(s.controllato_il.slice(0, 10)) + ')';
    else if (!s.url_configurato) txt += ' · aggiornamenti disattivati';
    updStato.innerHTML = txt;
    if (updInstBtn) updInstBtn.style.display = s.disponibile ? '' : 'none';
  };
  fetch('/api/updates').then(r => r.ok ? r.json() : null).then(showUpd).catch(() => {});
  if (updCheckBtn) updCheckBtn.onclick = async () => {
    updCheckBtn.disabled = true;
    try {
      const r = await fetch('/api/updates/check', { method: 'POST' });
      const s = await r.json();
      if (!r.ok) { toast(s.error || 'Controllo fallito'); return; }
      showUpd(s);
      toast(s.disponibile ? `Disponibile la versione ${s.ultima}` : 'Nessun aggiornamento disponibile');
    } catch { toast('Controllo fallito (rete non disponibile?)'); }
    finally { updCheckBtn.disabled = false; }
  };
  if (updInstBtn) updInstBtn.onclick = () => confirmDialog('Installare l\'aggiornamento?', 'Il nuovo software verrà scaricato e installato; il server si riavvia da solo e la pagina si ricarica. I dati non vengono toccati.', 'Installa', async () => {
    updInstBtn.disabled = true;
    try {
      const r = await fetch('/api/updates/install', { method: 'POST' });
      const s = await r.json();
      if (!r.ok) { toast(s.error || 'Installazione fallita'); updInstBtn.disabled = false; return; }
      toast(`Versione ${s.version} installata — riavvio in corso…`);
      // attende che il server torni su, poi ricarica sul codice nuovo
      const attesa = async () => {
        for (let i = 0; i < 40; i++) {
          await new Promise(ok => setTimeout(ok, 1500));
          try { const h = await fetch('/api/health'); if (h.ok) { location.reload(); return; } } catch {}
        }
        toast('Il server non è ancora ripartito: ricarica la pagina a mano.');
      };
      attesa();
    } catch { toast('Installazione fallita'); updInstBtn.disabled = false; }
  });

  root.querySelector('[data-wipe]').onclick = () => confirmDialog('Cancellare tutti i dati?', 'Operazione irreversibile. Esporta prima un backup.', 'Continua', () => {
    confirmDialog('Sei davvero sicuro?', 'Tutte le aziende, dipendenti, presenze e voci verranno eliminati.', 'Cancella tutto', () => {
      setData(DEFAULT_DATA()); toast('Dati cancellati');
    }, { danger: true });
  }, { danger: true });
}
