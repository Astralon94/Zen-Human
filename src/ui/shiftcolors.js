// ============ Scala di verdi dinamica per i tipi di turno ============
// I tipi di turno sono una lista libera per azienda (company.shiftTypes). La scala di
// verdi va quindi GENERATA: N tipi → N gradazioni dal chiaro allo scuro nell'ordine
// dell'array. Qui iniettiamo un piccolo <style> che, per ogni tipo, definisce sulla
// classe .sh-<id> le variabili --sh-bg (sfondo) e --sh-fg (testo). Il colore è interpolato
// in oklab tra i due estremi --present-scale-light/-dark (definiti per entrambi i temi in
// styles.css, così cambiano da soli con il tema); il testo è scuro sulla metà chiara della
// scala e bianco sulla metà scura (soglia a metà). Funziona con N qualsiasi (anche 1 o 5+).

import { companyShiftTypes } from '../state/model.js';

// Colore di sfondo (stringa CSS) per il tipo di turno di indice i su n totali.
export function shiftBg(i, n) {
  const frac = n <= 1 ? 0.5 : i / (n - 1);
  return `color-mix(in oklab, var(--present-scale-dark) ${Math.round(frac * 100)}%, var(--present-scale-light))`;
}
// Colore del testo leggibile sopra quella gradazione (scuro sotto metà scala, bianco sopra).
export function shiftFg(i, n) {
  const frac = n <= 1 ? 0.5 : i / (n - 1);
  return frac >= 0.5 ? '#fff' : 'var(--present-fg-dark)';
}

// ---- Versione "concreta" della scala (per l'export SVG→canvas) ----
// Nell'app la scala è delegata a color-mix(in oklab, …) su variabili CSS: comodo, ma
// dentro un SVG reso via canvas quelle funzioni/variabili NON si risolvono. Per l'export
// serve quindi lo STESSO calcolo restituito come esadecimale concreto: si interpola in
// oklab tra i due estremi sRGB (i token --present-scale-light/-dark, passati dal chiamante)
// esattamente come farebbe color-mix. Funzioni pure (nessun DOM): riusabili anche in Node.
function srgbToLin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function linToByte(c) { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(v * 255))); }
function hexToOklab(hex) {
  const h = hex.replace('#', '');
  const r = srgbToLin(parseInt(h.slice(0, 2), 16)), g = srgbToLin(parseInt(h.slice(2, 4), 16)), b = srgbToLin(parseInt(h.slice(4, 6), 16));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}
function oklabToHex({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const r = linToByte(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = linToByte(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bb = linToByte(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
  return '#' + [r, g, bb].map(x => x.toString(16).padStart(2, '0')).join('');
}
// Esadecimale interpolato tra lightHex (frac 0) e darkHex (frac 1) in oklab.
export function mixOklabHex(lightHex, darkHex, frac) {
  const A = hexToOklab(lightHex), B = hexToOklab(darkHex);
  return oklabToHex({ L: A.L + (B.L - A.L) * frac, a: A.a + (B.a - A.a) * frac, b: A.b + (B.b - A.b) * frac });
}
// Sfondo concreto del tipo di turno i su n (stessa scala di shiftBg, ma in esadecimale).
export function shiftBgHex(i, n, lightHex, darkHex) {
  return mixOklabHex(lightHex, darkHex, n <= 1 ? 0.5 : i / (n - 1));
}
// Testo concreto leggibile sopra quella gradazione (scuro sotto metà scala, bianco sopra).
export function shiftFgHex(i, n, fgDarkHex) {
  return (n <= 1 ? 0.5 : i / (n - 1)) >= 0.5 ? '#ffffff' : fgDarkHex;
}

// Rigenera le regole .sh-<id> per i tipi di turno dell'azienda attiva.
export function injectShiftScale(company) {
  const types = companyShiftTypes(company);
  const n = types.length;
  const css = types.map((t, i) => `.sh-${t.id}{--sh-bg:${shiftBg(i, n)};--sh-fg:${shiftFg(i, n)};}`).join('\n');
  let el = document.getElementById('shiftScale');
  if (!el) { el = document.createElement('style'); el.id = 'shiftScale'; document.head.appendChild(el); }
  el.textContent = css;
}
