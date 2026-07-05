// Test di regressione sul calcolo del netto (funzioni pure di domain/payroll.js).
// Nessun framework: si lancia con `node tests/payroll.test.mjs`.

import { data } from '../src/state/store.js';
import { monthlyNet, nettoConsulente, cellDeduction, shiftBonusSum, salaryFor } from '../src/domain/payroll.js';
import { migrate } from '../src/state/model.js';

let failed = 0;
const ok = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) failed++; };

const reset = () => { data.employees.length = 0; data.attendance.length = 0; data.entries.length = 0; };
const M = '2026-06';

reset();
const e = { id: 'E', companyId: 'co1', firstName: 'Mario', lastName: 'Rossi', active: true, salaries: [{ month: M, net: 1560 }], loans: [] };
data.employees.push(e);
ok('salaryFor: netto pattuito del mese', salaryFor(e, M) === 1560);

// permesso non retribuito: trattenuta automatica = netto ÷ 26 = 60
const a1 = { id: 'a1', companyId: 'co1', employeeId: 'E', date: '2026-06-02', status: 'permesso_nr', amount: 0, shift: null, shiftBonus: 0 };
data.attendance.push(a1);
ok('permesso_nr: trattenuta automatica netto/26 (60)', cellDeduction(e, M, a1) === 60);
a1.amount = 45;
ok('permesso_nr: importo manuale sovrascrive l\'automatico', cellDeduction(e, M, a1) === 45);
a1.amount = 0;

// giorno presente con turno e bonus turno
const a2 = { id: 'a2', companyId: 'co1', employeeId: 'E', date: '2026-06-03', status: 'present', amount: 0, shift: 'notte', shiftBonus: 20 };
data.attendance.push(a2);
ok('shiftBonusSum: somma i bonus turno del mese', shiftBonusSum(e, M) === 20);
ok('present: nessuna trattenuta', cellDeduction(e, M, a2) === 0);

// voci economiche
data.entries.push({ id: 'b1', companyId: 'co1', employeeId: 'E', month: M, kind: 'bonus', amount: 100, date: '2026-06-04', createdAt: Date.now() });
data.entries.push({ id: 's1', companyId: 'co1', employeeId: 'E', month: M, kind: 'sanction', amount: 30, date: '2026-06-05', createdAt: Date.now() });

// netto = 1560 + bonus 100 + bonus turni 20 − sanzioni 30 − assenze 60 = 1590
const n = monthlyNet(e, M);
ok('monthlyNet: bonus turni nel breakdown', n.shiftBonus === 20);
ok('monthlyNet: assenze includono il permesso_nr automatico', n.absences === 60);
ok('monthlyNet: netto = 1590', n.net === 1590);

// per il consulente: il bonus turno matura in busta (spettante)
const c = nettoConsulente(e, M);
ok('nettoConsulente: shiftBonus confluisce nello spettante (1590)', c.spettante === 1590);

// migrazione: i nuovi campi prendono i default
const md = migrate({
  companies: [{ id: 'co1', name: 'A' }],
  employees: [{ id: 'E2', companyId: 'co1', firstName: 'X' }],
  attendance: [{ id: 'z', employeeId: 'E2', date: '2026-06-01', status: 'present' }],
  entries: [{ id: 'q', employeeId: 'E2', kind: 'bonus', amount: 10, date: '2026-06-01' }]
});
ok('migrate: employee contract/notePrivate/noteConsultant = ""', md.employees[0].contract === '' && md.employees[0].notePrivate === '' && md.employees[0].noteConsultant === '');
ok('migrate: employee librettoSanitario = ""', md.employees[0].librettoSanitario === '');
ok('migrate: attendance shift=null, shiftBonus=0', md.attendance[0].shift === null && md.attendance[0].shiftBonus === 0);
ok('migrate: entry createdAt valorizzato dalla data', md.entries[0].createdAt > 0);

// ---- Scadenze (domain/deadlines.js) ----
import { deadlineTone, employeeDeadlines, companyDeadlines } from '../src/domain/deadlines.js';
import { pad2 } from '../src/domain/util.js';

// data a N giorni da oggi in 'YYYY-MM-DD' (per test deterministici indipendenti dalla data corrente)
const dayOffset = n => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

ok('deadlineTone: scaduta (<0)', deadlineTone(-1).level === 'expired');
ok('deadlineTone: in scadenza (entro soglia)', deadlineTone(10, 20).level === 'soon');
ok('deadlineTone: lontana (oltre soglia)', deadlineTone(40, 20).level === 'ok');
ok('deadlineTone: data assente', deadlineTone(null).level === 'none');

// contratto indeterminato: nessuna scadenza contratto, ma libretto sì
const eInd = { id: 'D1', companyId: 'co1', contractOpen: true, contractEnd: dayOffset(30), librettoSanitario: dayOffset(5) };
const dInd = employeeDeadlines(eInd);
ok('employeeDeadlines: indeterminato → solo libretto', dInd.length === 1 && dInd[0].type === 'libretto');

// contratto a termine + libretto: due scadenze
const eTerm = { id: 'D2', companyId: 'co1', contractOpen: false, contractEnd: dayOffset(40), librettoSanitario: dayOffset(3) };
const dTerm = employeeDeadlines(eTerm);
ok('employeeDeadlines: a termine + libretto → due scadenze', dTerm.length === 2 && dTerm.some(x => x.type === 'contract') && dTerm.some(x => x.type === 'libretto'));

// nessuna scadenza impostata
ok('employeeDeadlines: nessuna scadenza', employeeDeadlines({ id: 'D3', companyId: 'co1', contractOpen: false, contractEnd: '', librettoSanitario: '' }).length === 0);

// companyDeadlines: ordinate per data crescente e con dipendente allegato
reset();
data.companies.length = 0;
data.companies.push({ id: 'co1', name: 'A' });
data.employees.push({ ...eTerm, active: true, firstName: 'T', lastName: 'T' });
const cd = companyDeadlines('co1');
ok('companyDeadlines: due scadenze ordinate per data', cd.length === 2 && cd[0].date <= cd[1].date && cd[0].employee.id === 'D2');

console.log(failed ? `\n${failed} test FALLITI` : '\nTutti i test passati');
process.exit(failed ? 1 : 0);
