// ============ Utility di base: denaro, date, mesi, id, escaping ============

export const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

const eur = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
export const fmt = n => eur.format(round2(n));
export const fmtNum = n => round2(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Parsa un importo digitato dall'utente (gestisce virgola/punto, simboli). Ritorna numero >=0 o null.
export function parseAmount(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return isNaN(n) ? null : round2(Math.abs(n));
}

export const pad2 = n => String(n).padStart(2, '0');
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
export const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; };

export const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
export const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

// "2026-06" -> "Giugno 2026"
export function fmtMonth(m) {
  if (!m) return '';
  const [y, mm] = m.split('-');
  return `${MESI[parseInt(mm) - 1]} ${y}`;
}
// "2026-06" + offset mesi -> "2026-07"
export function shiftMonth(m, delta) {
  const [y, mm] = m.split('-').map(Number);
  const d = new Date(y, mm - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
// numero di giorni nel mese "YYYY-MM"
export function daysInMonth(m) {
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm, 0).getDate();
}
// indice giorno settimana (0=Lun … 6=Dom) per "YYYY-MM-DD"
export function weekdayMon0(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return (d.getDay() + 6) % 7;
}
export const monthOf = dateStr => (dateStr || '').slice(0, 7);

// "2026-06-23" -> "23/06/2026"
export function fmtDateFull(d) {
  if (!d) return '';
  const [y, m, g] = d.split('-');
  if (!g) return d;
  return `${g}/${m}/${y}`;
}

// id univoco, monotòno-ish (timestamp + random)
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fullName = e => `${(e.firstName || '').trim()} ${(e.lastName || '').trim()}`.trim() || 'Senza nome';
export const initials = e => ((e.firstName || ' ')[0] + (e.lastName || ' ')[0]).toUpperCase();

// ---- Contrasto testo su sfondo colorato (riusabile: griglia Turni + export) ----
// Da un esadecimale ('#rgb' o '#rrggbb') a [r,g,b]; fallback grigio se non valido.
export function hexToRgb(hex) {
  const h = String(hex || '').trim().replace('#', '');
  const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(s, 16);
  return (s.length === 6 && Number.isFinite(n)) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [168, 165, 157];
}
// Luminanza percepita normalizzata 0–1 (pesi WCAG/Rec.601 sui canali sRGB). Vicina a 1 per le
// tinte chiare, vicina a 0 per quelle scure.
export function perceivedLuminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}
// Sceglie testo scuro o chiaro per un dato sfondo: sopra la soglia (~0.55) lo sfondo è "chiaro"
// → testo scuro; sotto → testo bianco. Default coerenti con i token --txt (chiaro) dell'app.
export function pickTextColor(bg, { dark = '#26251f', light = '#ffffff', threshold = 0.55 } = {}) {
  return perceivedLuminance(bg) > threshold ? dark : light;
}
