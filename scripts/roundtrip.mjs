// Test d'integrità (Zen-Human): import → export lossless + rev monotòno + changeset granulare.
// Gira su DB in memoria per non toccare il file reale.
process.env.ZEN_DB = ':memory:';
import assert from 'node:assert/strict';
const { importData, exportData, applyChanges } = await import('../server/serialize.js');

// Dataset ricco: employee con salaries[] e loans[] (con plan[]) ANNIDATI, attendance, entries,
// campi "scomodi" (shift null, booleani, decimali).
const sample = {
  version: 1, rev: 7, savedAt: 111,
  settings: { theme: 'dark', activeCompany: 'co1' },
  companies: [{ id: 'co1', name: 'Flavor', emoji: '🏢', color: '#4f8a76', piva: '123', cf: 'ABC', note: 'n' }],
  employees: [{
    id: 'e1', companyId: 'co1', firstName: 'Mario', lastName: 'Rossi', role: 'Banconista', color: '#4f8a76',
    active: true, createdAt: 1000, contract: 'Tempo pieno', contractStart: '2021-01-01', contractEnd: '',
    contractOpen: true, librettoSanitario: '', notePrivate: 'nota', noteConsultant: '',
    salaries: [{ month: '2026-06', net: 1200 }, { month: '2026-07', net: 1250 }],
    loans: [{ id: 'l1', name: 'Anticipo', total: 600, count: 6, startMonth: '2026-06', amount: 100, notes: '',
      createdAt: 2000, plan: [{ n: 1, month: '2026-06', amount: 100, status: 'paid', skipped: false },
                              { n: 2, month: '2026-07', amount: 100, status: 'pending', skipped: false }] }],
  }],
  attendance: [
    { id: 'a1', companyId: 'co1', employeeId: 'e1', date: '2026-06-30', status: 'present', amount: 0, shift: 'notte', shiftBonus: 5, note: '' },
    { id: 'a2', companyId: 'co1', employeeId: 'e1', date: '2026-07-01', status: 'ferie', amount: 0, shift: null, shiftBonus: 0, note: '' },
  ],
  entries: [{ id: 'x1', companyId: 'co1', employeeId: 'e1', month: '2026-06', kind: 'bonus', amount: 50, date: '2026-06-15', desc: 'premio', createdAt: 3000 }],
};

const dropMeta = (o) => { const { rev, savedAt, version, ...rest } = o; return rest; };

importData(structuredClone(sample));
const out1 = exportData();
assert.equal(out1.rev, 8, 'rev max(7,0)+1 = 8');
assert.deepEqual(dropMeta(out1), dropMeta(sample), 'export deve coincidere col sample (lossless, incl. salaries/loans/plan annidati)');
console.log('✓ round-trip lossless (con nidificazione employee)');

importData(structuredClone(sample));
assert.equal(exportData().rev, 9, 'secondo import: rev monotòno = 9');
console.log('✓ rev monotòno');

let rejected = false;
try { importData({ foo: 'bar' }); } catch { rejected = true; }
assert.ok(rejected, 'struttura invalida rifiutata');
assert.equal(exportData().rev, 9, 'dati intatti dopo import rifiutato');
console.log('✓ import invalido rifiutato, dati intatti');

// changeset granulare: aggiorna e1 (nuovo stipendio), aggiunge a3, rimuove a1.
applyChanges({
  collections: {
    employees: { upsert: [{ ...sample.employees[0], salaries: [{ month: '2026-08', net: 1300 }] }] },
    attendance: { upsert: [{ id: 'a3', companyId: 'co1', employeeId: 'e1', date: '2026-07-02', status: 'present', amount: 0, shift: 'mattina', shiftBonus: 0, note: '' }], remove: ['a1'] },
  },
});
const d2 = exportData();
assert.equal(d2.employees[0].salaries[0].net, 1300, 'employee aggiornato via changeset');
const att = Object.fromEntries(d2.attendance.map((a) => [a.id, a]));
assert.ok(!att.a1 && att.a2 && att.a3, 'a1 rimossa, a3 aggiunta');
console.log('✓ changeset granulare (upsert/remove)');

console.log('\nZEN-HUMAN — TUTTI I TEST PASSATI ✅');
