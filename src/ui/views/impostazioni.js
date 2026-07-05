// ============ Vista Impostazioni ============
import { data, save, setData, fileSupported, vaultStatus, connectVault, reauthorizeVault, disconnectVault, listRestorePoints, restorePoint } from '../../state/store.js';
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

  if (fileSupported()) {
    const v = vaultStatus();
    h += `<div class="section-title">Cartella dati (vault)</div>`;
    h += `<div class="card">
      <div class="muted" style="font-size:13px;margin-bottom:10px">Scegli una cartella sul disco (anche in iCloud/Dropbox): l'app vi salva tutto automaticamente — <b>zen-human.json</b> più <b>backups/</b> e <b>snapshots/</b> ripristinabili. La copia nel browser resta come rete di sicurezza.</div>
      <div style="margin-bottom:10px;font-size:13px">${v.active ? `✅ Attiva · cartella <b>${esc(v.name || 'Zen Human')}</b>` : (v.needsPerm ? '⚠️ Cartella collegata ma da riautorizzare' : '○ Non attiva (salvataggio solo nel browser)')}</div>
      <div class="btnrow">
        ${v.needsPerm ? '<button class="btn primary" data-reauth>Riautorizza cartella</button>' : ''}
        ${v.active ? '<button class="btn" data-vchange>Cambia cartella…</button><button class="btn" data-vdisc>Scollega</button>' : '<button class="btn primary" data-vconn>Scegli cartella…</button>'}
      </div>
    </div>`;
    if (v.active) { h += `<div class="section-title">Ripristino (backup &amp; snapshot)</div><div id="v_restore" class="list"><div class="row"><div class="mid muted">Caricamento…</div></div></div>`; }
  } else {
    h += `<div class="section-title">Cartella dati</div><div class="card muted" style="font-size:13px">La cartella su disco è disponibile solo su Chrome desktop (File System Access API).</div>`;
  }

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

  h += `<div class="muted" style="text-align:center;font-size:12px;margin-top:24px">Zen Human · v${APP_BUILD} · 100% locale, nessun cloud</div>`;
  return h;
}

export function bind(root) {
  bindCompanies(root);
  root.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { data.settings.theme = b.dataset.th; save(); applyTheme(); });
  const connect = async () => { const r = await connectVault(); if (r.ok) toast('Cartella collegata ✓'); else if (!r.canceled) toast('Collegamento non riuscito'); };
  root.querySelector('[data-vconn]')?.addEventListener('click', connect);
  root.querySelector('[data-vchange]')?.addEventListener('click', connect);
  root.querySelector('[data-reauth]')?.addEventListener('click', async () => { const r = await reauthorizeVault(); toast(r.ok ? 'Cartella riautorizzata ✓' : 'Riautorizzazione non riuscita'); });
  root.querySelector('[data-vdisc]')?.addEventListener('click', () => { disconnectVault(); toast('Cartella scollegata'); });

  const rbox = root.querySelector('#v_restore');
  if (rbox) listRestorePoints().then(points => {
    if (!points.length) { rbox.innerHTML = '<div class="row"><div class="mid muted">Nessun punto di ripristino ancora disponibile.</div></div>'; return; }
    rbox.innerHTML = points.slice(0, 20).map(p => `<div class="row">
      <div class="emoji">${p.type === 'snapshot' ? '📅' : '🕑'}</div>
      <div class="mid"><div class="t1">${p.type === 'snapshot' ? 'Snapshot' : 'Backup'}</div><div class="t2">${new Date(p.mtime).toLocaleString('it-IT')} · ${(p.size / 1024).toFixed(0)} KB</div></div>
      <button class="btn sm" data-restore="${p.type}|${esc(p.file)}">Ripristina</button>
    </div>`).join('');
    rbox.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => {
      const [type, file] = b.dataset.restore.split('|');
      confirmDialog('Ripristinare questo punto?', 'I dati attuali verranno sostituiti (ne viene comunque tenuto un backup).', 'Ripristina', async () => { const r = await restorePoint(type, file); toast(r.ok ? 'Ripristinato ✓' : 'Ripristino non riuscito'); });
    });
  });

  root.querySelector('[data-wipe]').onclick = () => confirmDialog('Cancellare tutti i dati?', 'Operazione irreversibile. Esporta prima un backup.', 'Continua', () => {
    confirmDialog('Sei davvero sicuro?', 'Tutte le aziende, dipendenti, presenze e voci verranno eliminati.', 'Cancella tutto', () => {
      setData(DEFAULT_DATA()); toast('Dati cancellati');
    }, { danger: true });
  }, { danger: true });
}
