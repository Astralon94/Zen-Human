// ============ Shell applicativa: topbar, nav a tendina, selettore azienda, router ============
import './styles.css';
import { data, subscribe, save, onSaveStatus, saveStatus } from '../state/store.js';
import { esc } from '../domain/util.js';

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

// Spia di salvataggio: riflette lo stato reale confermato dal server.
function saveBadgeInner() {
  const conf = {
    saved:  { c: '#6b8f80', dot: '●', t: 'Salvato' },
    saving: { c: '#b08a4e', dot: '◍', t: 'Salvataggio…' },
    error:  { c: '#c2685f', dot: '▲', t: 'Non salvato' },
  };
  const m = conf[saveStatus()] || conf.saved;
  return `<span style="color:${m.c}">${m.dot} ${m.t}</span>`;
}
function refreshSaveBadge() { const el = document.getElementById('saveBadge'); if (el) el.innerHTML = saveBadgeInner(); }

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
      <span class="savebadge" id="saveBadge" title="Stato del salvataggio sul database" style="font-size:12px;font-weight:600;white-space:nowrap;margin-left:10px">${saveBadgeInner()}</span>
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

let booted = false;
export function startUI() {
  if (!booted) { subscribe(() => renderApp()); onSaveStatus(refreshSaveBadge); booted = true; }
  renderApp();
}
