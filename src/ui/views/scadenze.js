// ============ Vista Scadenze: contratti a termine + libretti sanitari ============
import { esc, fmtDateFull, fullName } from '../../domain/util.js';
import { activeCompany, co } from '../../domain/payroll.js';
import { companyDeadlines, deadlineTone, deadlineLabel, DEADLINE_TYPES } from '../../domain/deadlines.js';
import { openEmployee } from './dipendenti.js';
import { go } from '../app.js';

let typeFilter = 'all'; // 'all' | 'contract' | 'libretto'

export function render() {
  const cid = activeCompany();
  if (!cid) return `<div class="pagehead"><h1>Scadenze</h1></div><div class="card empty">Crea prima un'azienda dalla sezione Aziende.</div>`;

  let h = `<div class="pagehead"><h1>Scadenze</h1><span class="sub">${esc((co(cid)?.emoji || '') + ' ' + co(cid)?.name)}</span></div>`;

  const all = companyDeadlines(cid);
  if (!all.length) {
    h += `<div class="card empty">Nessuna scadenza da monitorare.<br><span class="muted" style="font-size:12.5px">Imposta la scadenza del contratto a termine o del libretto sanitario nella scheda di un dipendente.</span></div>`;
    return h;
  }

  // riepilogo: scadute / in scadenza (entro la soglia di preavviso del tipo) / totali
  const toned = all.map(d => ({ ...d, tone: deadlineTone(d.days, d.warnAt) }));
  const expired = toned.filter(d => d.tone.level === 'expired').length;
  const soon = toned.filter(d => d.tone.level === 'soon').length;
  h += `<div class="grid k3" style="margin-bottom:6px">
    <div class="card kpi"><div class="lbl">Scadute</div><div class="val tnum" style="color:${expired ? '#c2685f' : 'inherit'}">${expired}</div></div>
    <div class="card kpi"><div class="lbl">In scadenza</div><div class="val tnum" style="color:${soon ? '#c98a52' : 'inherit'}">${soon}</div></div>
    <div class="card kpi"><div class="lbl">Totali</div><div class="val tnum">${all.length}</div></div>
  </div>`;

  // filtro per tipo
  const chip = (k, label) => `<button class="chip ${typeFilter === k ? 'on' : ''}" data-filter="${k}">${label}</button>`;
  h += `<div class="chips">${chip('all', 'Tutte')}${chip('contract', `${DEADLINE_TYPES.contract.emoji} Contratti`)}${chip('libretto', `${DEADLINE_TYPES.libretto.emoji} Libretti`)}</div>`;

  const rows = toned.filter(d => typeFilter === 'all' || d.type === typeFilter);
  if (!rows.length) { h += `<div class="card empty">Nessuna scadenza di questo tipo.</div>`; return h; }

  h += `<div class="list">${rows.map(d => {
    const e = d.employee;
    return `<div class="row click" data-emp="${e.id}">
      <div class="emoji">${d.emoji}</div>
      <div class="mid">
        <div class="t1">${esc(fullName(e))}${e.active === false ? ' <span class="badge line">cessato</span>' : ''}</div>
        <div class="t2">${esc(d.label)} · scad. ${fmtDateFull(d.date)}</div>
      </div>
      <div class="amt"><span class="badge" style="background:${d.tone.color}">${esc(deadlineLabel(d.days))}</span></div>
    </div>`;
  }).join('')}</div>`;

  h += `<div class="muted" style="font-size:12px;margin-top:10px">Preavviso: contratti ${DEADLINE_TYPES.contract.warnAt} g · libretti sanitari ${DEADLINE_TYPES.libretto.warnAt} g. Tocca una riga per aprire il dipendente.</div>`;
  return h;
}

export function bind(root) {
  root.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { typeFilter = b.dataset.filter; rerender(); });
  root.querySelectorAll('[data-emp]').forEach(b => b.onclick = () => { openEmployee(b.dataset.emp); go('dip'); });
}

function rerender() { const root = document.getElementById('view'); root.innerHTML = render(); bind(root); }
