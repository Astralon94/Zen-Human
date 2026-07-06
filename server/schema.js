// ============ Specifica dello schema (Zen-Human) ============
// Modello IBRIDO documento-relazionale, come Zen-Finance:
//  - ogni entità ha una colonna `doc` con il JSON VERBATIM dell'oggetto → fonte di verità;
//    la ricostruzione avviene sempre da `doc` (round-trip lossless per costruzione).
//  - le altre colonne sono DERIVATE (sola scrittura) per query/indici.
// Per Zen-Human NON servono tabelle figlie: employees porta `salaries[]` e `loans[]`
// (con `plan[]`) ANNIDATI nel proprio doc (array piccoli, per-dipendente) e ci round-trippano.
// attendance ed entries sono collezioni di primo livello a sé.

const col = (n, type = 'TEXT', bool = false) => ({ n, type, bool });

export const COLLECTIONS = [
  { key: 'companies', table: 'companies', cols: [col('name'), col('piva'), col('cf')] },
  { key: 'employees', table: 'employees', index: ['companyId'],
    cols: [col('companyId'), col('lastName'), col('role'), col('active', 'INTEGER', true)] },
  { key: 'attendance', table: 'attendance', index: ['companyId', 'employeeId', 'date'],
    cols: [col('companyId'), col('employeeId'), col('date'), col('status')] },
  { key: 'entries', table: 'entries', index: ['companyId', 'employeeId', 'month'],
    cols: [col('companyId'), col('employeeId'), col('month'), col('kind'), col('amount', 'REAL')] },
];
