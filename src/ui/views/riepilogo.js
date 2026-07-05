// ============ Vista Riepilogo: prospetto mensile per il consulente del lavoro ============
import { data } from '../../state/store.js';
import { STATUS_ORDER, STATUSES } from '../../state/model.js';
import { esc, fmt, fmtNum, fmtMonth, shiftMonth, fullName, daysInMonth, weekdayMon0, pad2, GIORNI, round2, thisMonth, MESI } from '../../domain/util.js';
import { activeCompany, co, companyEmployees, monthlyNet, attendanceStats, attendanceCell, statusInfo, nettoConsulente } from '../../domain/payroll.js';
import { printDocument, downloadText, toast } from '../dom.js';
import { go } from '../app.js';
import { openEmployee, getMonth, setMonth } from './dipendenti.js';

// stati mostrati come colonne nel prospetto (esclude "riposo")
const COLS = STATUS_ORDER.filter(k => k !== 'riposo');

export function render() {
  const cid = activeCompany();
  if (!cid) return `<div class="pagehead"><h1>Riepilogo</h1></div><div class="card empty">Crea prima un'azienda dalla sezione Aziende.</div>`;
  const month = getMonth();
  const emps = companyEmployees(cid);

  let h = `<div class="pagehead"><h1>Riepilogo</h1><span class="sub">${esc((co(cid)?.emoji || '') + ' ' + co(cid)?.name)}</span></div>`;
  h += `<div class="card" style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
    <button class="btn sm" data-mprev>‹</button>
    <div style="flex:1;text-align:center;font-weight:700">${esc(fmtMonth(month))}</div>
    <button class="btn sm" data-mnext>›</button>
    <button class="btn sm" data-mtoday>Oggi</button>
  </div>`;

  if (!emps.length) { h += `<div class="card empty">Nessun dipendente attivo in questa azienda.</div>`; return h; }

  // totale netto del mese
  const totalNet = emps.reduce((s, e) => s + monthlyNet(e, month).net, 0);
  h += `<div class="grid k3" style="margin-bottom:6px">
    <div class="card kpi"><div class="lbl">Dipendenti</div><div class="val tnum">${emps.length}</div></div>
    <div class="card kpi"><div class="lbl">Netto totale</div><div class="val tnum">${fmt(totalNet)}</div></div>
    <div class="card kpi"><div class="lbl">Mese</div><div class="val" style="font-size:16px">${esc(fmtMonth(month))}</div></div>
  </div>`;

  h += `<div class="section-title">Presenze / assenze<span class="grow"></span>
    <button class="btn sm primary" data-pdfcons>PDF consulente</button>
    <button class="btn sm" data-pdf>PDF interno</button>
    <button class="btn sm" data-csv>CSV</button></div>`;

  h += `<div class="list" style="overflow-x:auto"><table class="tbl">
    <thead><tr><th>Dipendente</th><th class="r">Lav.</th>${COLS.map(k => `<th class="r" title="${esc(STATUSES[k].label)}">${STATUSES[k].short}</th>`).join('')}<th class="r">Netto</th></tr></thead>
    <tbody>`;
  emps.forEach(e => {
    const st = attendanceStats(e, month);
    const n = monthlyNet(e, month);
    h += `<tr class="click" data-emp="${e.id}" style="cursor:pointer">
      <td>${esc(fullName(e))}</td>
      <td class="r">${st.worked || ''}</td>
      ${COLS.map(k => `<td class="r">${st.counts[k] || ''}</td>`).join('')}
      <td class="r tnum">${fmt(n.net)}</td></tr>`;
  });
  const totWorked = emps.reduce((s, e) => s + attendanceStats(e, month).worked, 0);
  h += `<tr class="tot"><td>Totale</td><td class="r">${totWorked}</td>${COLS.map(k => `<td class="r">${emps.reduce((s, e) => s + (attendanceStats(e, month).counts[k] || 0), 0) || ''}</td>`).join('')}<td class="r tnum">${fmt(totalNet)}</td></tr>`;
  h += `</tbody></table></div>`;
  h += `<div class="muted" style="font-size:12px;margin-top:10px">Legenda: ${COLS.map(k => `<b>${STATUSES[k].short}</b> ${esc(STATUSES[k].label)}`).join(' · ')}. Lav. = giorni lavorati.</div>`;
  return h;
}

export function bind(root) {
  root.querySelector('[data-mprev]').onclick = () => { setMonth(shiftMonth(getMonth(), -1)); rerender(); };
  root.querySelector('[data-mnext]').onclick = () => { setMonth(shiftMonth(getMonth(), 1)); rerender(); };
  root.querySelector('[data-mtoday]')?.addEventListener('click', () => { setMonth(thisMonth()); rerender(); });
  root.querySelectorAll('[data-emp]').forEach(b => b.onclick = () => { openEmployee(b.dataset.emp); go('dip'); });
  root.querySelector('[data-pdf]')?.addEventListener('click', exportPDF);
  root.querySelector('[data-pdfcons]')?.addEventListener('click', exportConsulente);
  root.querySelector('[data-csv]')?.addEventListener('click', exportCSV);
}

function rerender() { const root = document.getElementById('view'); root.innerHTML = render(); bind(root); }

function exportPDF() {
  const cid = activeCompany(); const month = getMonth();
  const emps = companyEmployees(cid);
  if (!emps.length) { toast('Nessun dipendente'); return; }
  const company = co(cid);
  let body = `<h1>Prospetto presenze — ${esc(fmtMonth(month))}</h1>
    <div class="meta">${esc(company.name)}${company.piva ? ' · P.IVA ' + esc(company.piva) : ''}</div>`;
  body += `<table><thead><tr><th>Dipendente</th><th class="r">Lav.</th>${COLS.map(k => `<th class="r">${STATUSES[k].short}</th>`).join('')}<th class="r">Netto</th></tr></thead><tbody>`;
  let totNet = 0;
  emps.forEach(e => {
    const st = attendanceStats(e, month); const n = monthlyNet(e, month); totNet += n.net;
    body += `<tr><td>${esc(fullName(e))}</td><td class="r">${st.worked}</td>${COLS.map(k => `<td class="r">${st.counts[k] || 0}</td>`).join('')}<td class="r">${fmtNum(n.net)} €</td></tr>`;
  });
  body += `<tr class="tot"><td>Totale netto</td><td class="r"></td>${COLS.map(() => '<td class="r"></td>').join('')}<td class="r">${fmtNum(totNet)} €</td></tr>`;
  body += `</tbody></table>`;
  body += `<h2>Dettaglio voci e trattenute</h2><table><thead><tr><th>Dipendente</th><th class="r">Pattuito</th><th class="r">Bonus</th><th class="r">Bonus turni</th><th class="r">Sanzioni</th><th class="r">Acconti</th><th class="r">Rate</th><th class="r">Assenze</th><th class="r">Netto</th></tr></thead><tbody>`;
  emps.forEach(e => {
    const n = monthlyNet(e, month);
    body += `<tr><td>${esc(fullName(e))}</td><td class="r">${fmtNum(n.base)}</td><td class="r">${fmtNum(n.bonus)}</td><td class="r">${fmtNum(n.shiftBonus)}</td><td class="r">${fmtNum(n.sanctions)}</td><td class="r">${fmtNum(n.advances)}</td><td class="r">${fmtNum(n.loans)}</td><td class="r">${fmtNum(n.absences)}</td><td class="r">${fmtNum(n.net)}</td></tr>`;
  });
  body += `</tbody></table>`;
  body += `<div class="meta">Legenda: ${COLS.map(k => `${STATUSES[k].short} = ${esc(STATUSES[k].label)}`).join(' · ')}. Documento generato da Zen Human.</div>`;
  printDocument(`Prospetto ${company.name} ${month}`, body);
}

// PDF per il consulente del lavoro: per ogni dipendente solo nome, calendario visivo,
// netto busta paga e quota già anticipata (acconti) / trattenuta (rate prestito).
function exportConsulente() {
  const cid = activeCompany(); const month = getMonth();
  const emps = companyEmployees(cid);
  if (!emps.length) { toast('Nessun dipendente'); return; }
  const company = co(cid);

  let body = `<h1>Prospetto per il consulente — ${esc(fmtMonth(month))}</h1>
    <div class="meta">${esc(company.name)}${company.piva ? ' · P.IVA ' + esc(company.piva) : ''}</div>`;

  let totBusta = 0, totResiduo = 0, cards = '';
  emps.forEach(e => {
    const c = nettoConsulente(e, month);
    totBusta += c.spettante; totResiduo += c.residuo;
    const netLine = `<div style="font-size:8.5px;margin-top:3px;border-top:1px solid #ccc;padding-top:3px;line-height:1.35">
      Netto busta <b>${fmtNum(c.spettante)} €</b>${c.anticipato ? ` · anticipato ${fmtNum(c.anticipato)} € · <b>residuo ${fmtNum(c.residuo)} €</b>` : ''}</div>`;
    cards += `<div style="page-break-inside:avoid;break-inside:avoid;border:1px solid #ddd;border-radius:5px;padding:5px 7px">
      <div style="font-size:10.5px;font-weight:700;line-height:1.2">${esc(fullName(e))}${e.role ? ` <span style="font-weight:400;color:#777;font-size:8.5px">· ${esc(e.role)}</span>` : ''}</div>
      ${calGridHTML(e, month)}
      ${netLine}
    </div>`;
  });

  body += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${cards}</div>`;
  body += `<div style="page-break-inside:avoid;border-top:2px solid #999;margin-top:12px;padding-top:8px;font-size:11px">
    <b>Totale netto buste:</b> ${fmtNum(totBusta)} € · <b>Totale residuo da liquidare:</b> ${fmtNum(totResiduo)} €</div>`;
  // Note per il consulente: allegate solo se compilate
  const withNotes = emps.filter(e => (e.noteConsultant || '').trim());
  if (withNotes.length) {
    body += `<div style="page-break-inside:avoid;margin-top:12px;border-top:1px solid #ccc;padding-top:8px">
      <div style="font-weight:700;font-size:11px;margin-bottom:5px">Note per il consulente</div>
      ${withNotes.map(e => `<div style="font-size:9.5px;margin-bottom:4px;line-height:1.35"><b>${esc(fullName(e))}</b>: ${esc(e.noteConsultant.trim())}</div>`).join('')}
    </div>`;
  }
  body += `<div class="meta" style="margin-top:8px;font-size:9px">Legenda: ${COLS.map(k => `${STATUSES[k].short} = ${esc(STATUSES[k].label)}`).join(' · ')}. Documento generato da Zen Human.</div>`;

  const [yy, mm] = month.split('-');
  printDocument(`prospetto_bustepaga_${(MESI[+mm - 1] || mm).toLowerCase()}_${yy}`, body);
}

// mini-calendario visivo compatto (stili inline, per la stampa)
function calGridHTML(e, month) {
  const dim = daysInMonth(month);
  const first = weekdayMon0(`${month}-01`);
  const head = GIORNI.map(g => `<div style="text-align:center;font-size:6.5px;font-weight:700;color:#999">${g[0]}</div>`).join('');
  let cells = '';
  for (let i = 0; i < first; i++) cells += `<div></div>`;
  for (let d = 1; d <= dim; d++) {
    const ds = `${month}-${pad2(d)}`;
    const cell = attendanceCell(e, ds);
    const wknd = weekdayMon0(ds) >= 5;
    const bg = cell ? statusInfo(cell.status).color : (wknd ? '#f0f0f3' : '#ffffff');
    const fg = cell ? '#ffffff' : '#aaa';
    const code = cell ? statusInfo(cell.status).short : '';
    cells += `<div style="border:1px solid #e2e2e2;border-radius:2px;min-height:15px;text-align:center;background:${bg};color:${fg};font-size:6.5px;line-height:1.05;padding:1px 0">
      <div style="font-weight:700">${d}</div><div>${esc(code)}</div></div>`;
  }
  return `<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;margin:3px 0">${head}${cells}</div>`;
}

function exportCSV() {
  const cid = activeCompany(); const month = getMonth();
  const emps = companyEmployees(cid);
  if (!emps.length) { toast('Nessun dipendente'); return; }
  const sep = ';';
  // quoting RFC-4180: protegge campi con separatore, virgolette o a-capo
  const q = v => { const s = String(v ?? ''); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const line = arr => arr.map(q).join(sep);
  const head = ['Dipendente', 'Mansione', 'Lavorati', ...COLS.map(k => STATUSES[k].label), 'Pattuito', 'Bonus', 'Bonus turni', 'Sanzioni', 'Acconti', 'Rate prestiti', 'Trattenute assenze', 'Netto'];
  const rows = [line(head)];
  emps.forEach(e => {
    const st = attendanceStats(e, month); const n = monthlyNet(e, month);
    rows.push(line([
      fullName(e), e.role || '', st.worked,
      ...COLS.map(k => st.counts[k] || 0),
      num(n.base), num(n.bonus), num(n.shiftBonus), num(n.sanctions), num(n.advances), num(n.loans), num(n.absences), num(n.net)
    ]));
  });
  const fname = `prospetto-${(co(cid).name || 'azienda').replace(/[^\p{L}\p{N}]+/gu, '_')}-${month}.csv`;
  downloadText(fname, rows.join('\r\n'));
  toast('CSV esportato ✓');
}
// numero per CSV: niente separatore migliaia, virgola decimale (Excel IT)
const num = n => round2(n).toFixed(2).replace('.', ',');
