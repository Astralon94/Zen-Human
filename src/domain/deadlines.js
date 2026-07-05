// ============ Scadenze dipendente: contratto a termine + libretto sanitario ============
// Tutto derivato dai fatti sul dipendente (contractEnd/contractOpen, librettoSanitario).
// Nessuno stato viene salvato: la vista Scadenze si ricalcola sempre da qui.

import { todayStr } from './util.js';
import { companyEmployees } from './payroll.js';

// giorni da oggi alla data (negativo = già passata, 0 = oggi, null = data assente)
export function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.round((new Date(dateStr + 'T00:00:00') - new Date(todayStr() + 'T00:00:00')) / 86400000);
}

// tono/livello di una scadenza in base ai giorni mancanti (warnAt = soglia di preavviso)
// livelli: 'expired' (scaduta) · 'soon' (in scadenza) · 'ok' (lontana)
export function deadlineTone(days, warnAt = 30) {
  if (days == null) return { level: 'none', color: '#8a8a8e' };
  if (days < 0) return { level: 'expired', color: '#c2685f' };
  if (days <= warnAt) return { level: 'soon', color: '#c98a52' };
  return { level: 'ok', color: '#4f8a76' };
}

// etichetta relativa leggibile: "scade oggi" · "tra 12 g" · "scaduto da 5 g"
export function deadlineLabel(days) {
  if (days == null) return '';
  if (days === 0) return 'scade oggi';
  if (days > 0) return `tra ${days} g`;
  return `scaduto da ${-days} g`;
}

// tipi di scadenza gestiti (soglia di preavviso specifica per tipo)
export const DEADLINE_TYPES = {
  contract: { label: 'Contratto a termine', emoji: '📄', warnAt: 20 },
  libretto: { label: 'Libretto sanitario', emoji: '🩺', warnAt: 30 }
};

// scadenze attive di un dipendente: contratto (solo se a termine con data) + libretto sanitario
export function employeeDeadlines(e) {
  const out = [];
  if (!e.contractOpen && e.contractEnd) {
    const t = DEADLINE_TYPES.contract;
    out.push({ type: 'contract', date: e.contractEnd, days: daysUntil(e.contractEnd), ...t });
  }
  if (e.librettoSanitario) {
    const t = DEADLINE_TYPES.libretto;
    out.push({ type: 'libretto', date: e.librettoSanitario, days: daysUntil(e.librettoSanitario), ...t });
  }
  return out;
}

// tutte le scadenze dell'azienda, ciascuna con il dipendente, ordinate per data crescente
// (le più imminenti/scadute finiscono naturalmente in cima)
export function companyDeadlines(cid, { includeInactive = false } = {}) {
  const rows = [];
  companyEmployees(cid, { includeInactive }).forEach(e => {
    employeeDeadlines(e).forEach(d => rows.push({ ...d, employee: e }));
  });
  return rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
}
