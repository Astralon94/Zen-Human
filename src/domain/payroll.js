// ============ Calcoli di dominio: stipendio, presenze, prestiti, netto mensile ============
// Tutto è DERIVATO dai fatti memorizzati. Nessuno stato/totale viene salvato.

import { data } from '../state/store.js';
import { STATUSES, ENTRY_KINDS } from '../state/model.js';
import { round2, monthOf } from './util.js';

// ---- Lookup base ----
export const activeCompany = () => data.settings.activeCompany || null;
export const co = id => data.companies.find(c => c.id === id) || null;
export const emp = id => data.employees.find(e => e.id === id) || null;

export function companyEmployees(companyId, { includeInactive = false } = {}) {
  return data.employees
    .filter(e => e.companyId === companyId && (includeInactive || e.active !== false))
    .sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '') || (a.firstName || '').localeCompare(b.firstName || ''));
}

// ---- Stipendio storicizzato per mese ----
// Ritorna il netto pattuito vigente nel mese richiesto (l'ultima voce con month <= target).
export function salaryFor(e, month) {
  if (!e || !Array.isArray(e.salaries) || !e.salaries.length) return 0;
  const applicable = e.salaries.filter(s => s.month <= month).sort((a, b) => a.month.localeCompare(b.month));
  if (applicable.length) return round2(applicable[applicable.length - 1].net);
  // se non c'è nessuna voce precedente, usa la prima disponibile (evita 0 fuorviante)
  const first = e.salaries.slice().sort((a, b) => a.month.localeCompare(b.month))[0];
  return first ? round2(first.net) : 0;
}
export function setSalary(e, month, net) {
  const i = e.salaries.findIndex(s => s.month === month);
  if (i >= 0) e.salaries[i].net = round2(net);
  else e.salaries.push({ month, net: round2(net) });
  e.salaries.sort((a, b) => a.month.localeCompare(b.month));
}

// ---- Voci economiche del mese ----
export function monthEntries(e, month) {
  return data.entries.filter(x => x.employeeId === e.id && x.month === month);
}
export function entriesSum(e, month, kind) {
  return round2(monthEntries(e, month).filter(x => x.kind === kind).reduce((s, x) => s + (Number(x.amount) || 0), 0));
}

// ---- Presenze ----
export function attendanceFor(e, month) {
  return data.attendance.filter(a => a.employeeId === e.id && monthOf(a.date) === month);
}
export function attendanceCell(e, dateStr) {
  return data.attendance.find(a => a.employeeId === e.id && a.date === dateStr) || null;
}
// Importo da scalare per un singolo giorno. Per "permesso non retribuito" è AUTOMATICO
// (netto pattuito ÷ 26), sovrascrivibile inserendo un importo manuale > 0. Per gli altri stati
// vale l'eventuale importo manuale. È derivato: si ricalcola se cambia il netto pattuito del mese.
export function cellDeduction(e, month, a) {
  if (!a) return 0;
  if (a.status === 'permesso_nr') {
    const manual = Number(a.amount) || 0;
    return manual > 0 ? round2(manual) : round2(salaryFor(e, month) / 26);
  }
  return round2(Number(a.amount) || 0);
}

// conteggi per stato + totale importi da scalare
export function attendanceStats(e, month) {
  const rows = attendanceFor(e, month);
  const counts = {};
  let deductions = 0, worked = 0, absences = 0;
  rows.forEach(a => {
    counts[a.status] = (counts[a.status] || 0) + 1;
    deductions += cellDeduction(e, month, a);
    const k = STATUSES[a.status]?.kind;
    if (k === 'work') worked++;
    else if (k === 'absence') absences++;
  });
  return { counts, deductions: round2(deductions), worked, absences, marked: rows.length };
}

// somma dei bonus turno del mese (legati ai giorni "Presente"); confluisce nel netto come i bonus
export function shiftBonusSum(e, month) {
  return round2(attendanceFor(e, month).reduce((s, a) => s + (Number(a.shiftBonus) || 0), 0));
}

// ---- Prestiti rateizzati ----
// Genera un piano rate uniforme: count rate da startMonth, importo = amount.
export function buildLoanPlan(total, count, startMonth, amount) {
  const plan = [];
  let m = startMonth;
  for (let n = 1; n <= count; n++) {
    plan.push({ n, month: m, amount: round2(amount), status: 'pending', skipped: false });
    m = shift(m, 1);
  }
  // aggiusta l'ultima rata per far quadrare il totale (arrotondamenti)
  if (count > 0 && total) {
    const sum = plan.reduce((s, r) => s + r.amount, 0);
    const diff = round2(total - sum);
    if (Math.abs(diff) >= 0.01) plan[plan.length - 1].amount = round2(plan[plan.length - 1].amount + diff);
  }
  return plan;
}
function shift(m, d) { const [y, mm] = m.split('-').map(Number); const x = new Date(y, mm - 1 + d, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; }

// rate che scadono in un dato mese (non saltate), su tutti i prestiti del dipendente
export function loanInstallmentsForMonth(e, month) {
  const out = [];
  (e.loans || []).forEach(l => {
    (l.plan || []).forEach(r => { if (r.month === month && !r.skipped) out.push({ loan: l, inst: r }); });
  });
  return out;
}
export function loanDeductionForMonth(e, month) {
  return round2(loanInstallmentsForMonth(e, month).reduce((s, x) => s + (Number(x.inst.amount) || 0), 0));
}
export function loanResiduo(l) {
  return round2((l.plan || []).filter(r => !r.skipped && r.status !== 'paid').reduce((s, r) => s + (Number(r.amount) || 0), 0));
}
export function loanPaid(l) {
  return round2((l.plan || []).filter(r => !r.skipped && r.status === 'paid').reduce((s, r) => s + (Number(r.amount) || 0), 0));
}

// ---- Netto mensile (il cuore del prospetto) ----
// netto = pattuito + bonus − sanzioni − acconti − rate prestiti − importi assenze (manuali)
export function monthlyNet(e, month) {
  const base = salaryFor(e, month);
  const bonus = entriesSum(e, month, 'bonus');
  const shiftBonus = shiftBonusSum(e, month);
  const sanctions = entriesSum(e, month, 'sanction');
  const advances = entriesSum(e, month, 'advance');
  const loans = loanDeductionForMonth(e, month);
  const absences = attendanceStats(e, month).deductions;
  const net = round2(base + bonus + shiftBonus - sanctions - advances - loans - absences);
  return { base, bonus, shiftBonus, sanctions, advances, loans, absences, net };
}

// ---- Scomposizione per il consulente del lavoro ----
// spettante = quanto matura nel mese in busta (pattuito + bonus − sanzioni − assenze)
// anticipato = quanto è già stato corrisposto/trattenuto fuori busta (acconti + rate prestito)
// residuo = quanto resta da liquidare (== monthlyNet.net)
export function nettoConsulente(e, month) {
  const n = monthlyNet(e, month);
  const spettante = round2(n.base + n.bonus + n.shiftBonus - n.sanctions - n.absences);
  const anticipato = round2(n.advances + n.loans);
  return { spettante, anticipato, residuo: n.net, advances: n.advances, loans: n.loans };
}

// ---- Etichette ----
export const statusInfo = key => STATUSES[key] || { label: key, emoji: '•', color: '#8a8a8e', kind: 'absence' };
export const entryInfo = kind => ENTRY_KINDS[kind] || { label: kind, emoji: '•', sign: -1 };
