// ============ Shell applicativa: topbar, nav a tendina, selettore azienda, router ============
import './styles.css';
import { data, subscribe, subscribeMeta, save, vaultStatus, connectVault, reauthorizeVault, vaultMeta } from '../state/store.js';
import { esc, pad2 } from '../domain/util.js';
import { toast } from './dom.js';

import * as riepilogo from './views/riepilogo.js';
import * as compilazione from './views/compilazione.js';
import * as bonusSanzioni from './views/bonus-sanzioni.js';
import * as dipendenti from './views/dipendenti.js';
import * as scadenze from './views/scadenze.js';
import * as impostazioni from './views/impostazioni.js';

const VIEWS = {
  rie: { mod: riepilogo, title: 'Riepilogo', icon: '◷' },
  comp: { mod: compilazione, title: 'Compilazione', icon: '🗓️' },
  bse: { mod: bonusSanzioni, title: 'Voci economiche', icon: '➕' },
  dip: { mod: dipendenti, title: 'Dipendenti', icon: '👤' },
  sca: { mod: scadenze, title: 'Scadenze', icon: '⏳' },
  set: { mod: impostazioni, title: 'Impostazioni', icon: '⚙' }
};
const ORDER = ['rie', 'comp', 'bse', 'dip', 'sca', 'set'];

let current = 'rie';
let mql = window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme() {
  const t = data.settings.theme || 'auto';
  const dark = t === 'dark' || (t === 'auto' && mql.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
mql.addEventListener('change', applyTheme);

export function go(view) { current = view; renderApp(); window.scrollTo(0, 0); }

function companySelect() {
  const ac = data.settings.activeCompany;
  if (!data.companies.length) return '';
  const opts = data.companies.map(c => `<option value="${c.id}" ${ac === c.id ? 'selected' : ''}>${esc((c.emoji || '') + ' ' + c.name)}</option>`);
  return `<select class="selbox" id="coSel" aria-label="Azienda attiva">${opts.join('')}</select>`;
}

// Timestamp leggibile: solo hh:mm se è oggi, altrimenti gg/mm hh:mm. "—" se mai avvenuto.
function fmtTs(t) {
  if (!t) return '—';
  const d = new Date(t), now = new Date();
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  return d.toDateString() === now.toDateString() ? hm : `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)} ${hm}`;
}

// Badge topbar: ultimo snapshot e ultimo backup del vault, aggiornati in tempo reale.
function metaBadgeInner() {
  const m = vaultMeta();
  return `<span class="mb-item"><span class="mb-k">Snapshot</span><span class="mb-v tnum">${fmtTs(m.lastSnapshotAt)}</span></span>
    <span class="mb-sep"></span>
    <span class="mb-item"><span class="mb-k">Backup</span><span class="mb-v tnum">${fmtTs(m.lastBackupAt)}</span></span>`;
}
function refreshMetaBadge() { const el = document.getElementById('metaBadge'); if (el) el.innerHTML = metaBadgeInner(); }

function navMenu() {
  const items = ORDER.map(k => {
    const v = VIEWS[k];
    return `<button data-go="${k}" class="${current === k ? 'on' : ''}"><span class="ic">${v.icon}</span>${esc(v.title)}</button>`;
  }).join('');
  return `<div class="navwrap">
    <button class="navbtn" id="navToggle"><span>☰</span><span>${esc(VIEWS[current].title)}</span></button>
    <div class="navmenu" id="navMenu">${items}</div>
  </div>`;
}

export function renderApp() {
  applyTheme();
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="topbar">
      ${navMenu()}
      <span class="brand">Zen Human</span>
      <span class="metabadge" id="metaBadge" title="Ultimo snapshot e ultimo backup salvati sul disco">${metaBadgeInner()}</span>
      <span class="spacer"></span>
      ${companySelect()}
    </div>
    <main><div id="view" class="${current === 'comp' ? 'wide' : ''}"></div></main>`;

  const toggle = app.querySelector('#navToggle');
  const menu = app.querySelector('#navMenu');
  toggle.onclick = e => { e.stopPropagation(); menu.classList.toggle('open'); };
  menu.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { menu.classList.remove('open'); go(b.dataset.go); });

  const sel = app.querySelector('#coSel');
  if (sel) sel.onchange = () => { data.settings.activeCompany = sel.value || null; save(); };

  const root = app.querySelector('#view');
  const v = VIEWS[current].mod;
  root.innerHTML = v.render();
  if (v.bind) v.bind(root);
}

// ---- Gate: l'app richiede una cartella dati collegata (File System Access, Chrome) ----
function gateState() {
  const v = vaultStatus();
  if (!v.supported) return 'unsupported';
  if (v.active) return 'ok';
  if (v.needsPerm) return 'reauth';
  return 'connect';
}

const GATE_ICON = `<div class="gate-icon"><svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="17" rx="3"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="16" y1="2.5" x2="16" y2="6.5"/><circle cx="8" cy="14" r="1"/><circle cx="12" cy="14" r="1"/><circle cx="16" cy="14" r="1"/></svg></div>`;

function renderGate(state) {
  const app = document.getElementById('app');
  let msg, btn = '', foot = '';
  if (state === 'unsupported') {
    msg = `Questa app è local-first e richiede l'accesso a una cartella sul disco tramite il <b>File System Access</b> di Chrome. Aprila con Google Chrome o un browser Chromium su Mac/PC.`;
  } else if (state === 'reauth') {
    msg = `La cartella dati è collegata ma serve <b>riautorizzare</b> l'accesso per continuare.`;
    btn = `<button class="btn primary" id="gateBtn">Riautorizza cartella</button>`;
    foot = `La copia nel browser resta come rete di sicurezza.`;
  } else {
    msg = `Scegli una cartella sul disco (anche in iCloud/Dropbox): Zen Human vi salverà automaticamente tutti i dati di aziende e dipendenti, con backup e snapshot ripristinabili. Nessun cloud, nessun account.`;
    btn = `<button class="btn primary" id="gateBtn">Scegli la cartella dati…</button>`;
    foot = `La copia nel browser resta come rete di sicurezza.`;
  }
  app.innerHTML = `<div class="gate"><div class="gate-card">
    ${GATE_ICON}
    <h1>Zen Human</h1>
    <p>${msg}</p>
    ${btn}
    ${foot ? `<div class="gate-foot">${foot}</div>` : ''}
  </div></div>`;
  const b = app.querySelector('#gateBtn');
  if (b) b.onclick = async () => {
    b.disabled = true;
    const r = state === 'reauth' ? await reauthorizeVault() : await connectVault();
    b.disabled = false;
    if (r.ok) route();
    else if (!r.canceled) toast('Operazione non riuscita');
  };
}

function route() {
  applyTheme();
  if (gateState() === 'ok') renderApp();
  else renderGate(gateState());
}

let booted = false;
export function startUI() {
  if (!booted) {
    subscribe(() => route());
    subscribeMeta(refreshMetaBadge);      // aggiorna il badge a ogni snapshot/backup
    setInterval(refreshMetaBadge, 30000); // rinfresca le etichette (es. passaggio di giorno)
    booted = true;
  }
  route();
}
