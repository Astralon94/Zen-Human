// ============ Export Turni: SVG → JPEG (canvas) → PDF, e ZIP per dipendente ============
// Due export per la sezione Turni, sul periodo correntemente visualizzato:
//   1) exportTablePdf  → un PDF (A4 orizzontale) con la griglia giorni×turni×ruoli e i
//      nomi dei dipendenti assegnati (uso interno). Paginato per blocchi di giorni.
//   2) exportEmployeesZip → uno ZIP con un PDF individuale (A4 verticale) per ogni
//      dipendente con almeno un turno nel periodo (data · giorno · turno con orario · ruolo).
// Zero dipendenze: si renderizza un SVG (estetica Zen-Human), lo si rasterizza in JPEG via
// canvas e lo si incapsula col writer PDF puro (domain/pdf.js). Lo ZIP è "store" (i JPEG
// dentro i PDF sono già compressi).

import { data } from '../state/store.js';
import { co, emp, companyEmployees } from './payroll.js';
import { companyShiftTypes, shiftTypeById, companyRoles, roleById, STATUSES, EMPLOYEE_COLOR_FALLBACK } from '../state/model.js';
import { esc, pad2, fullName, GIORNI, MESI, weekdayMon0, pickTextColor } from './util.js';
import { shiftBgHex, shiftFgHex } from '../ui/shiftcolors.js';
import { PAGE, jpegPagesToPdf, buildPdfBytes } from './pdf.js';

// ---- Palette "stampa" (sempre chiara), replicata dai token di src/ui/styles.css (tema light) ----
// I valori sono presi 1:1 dai token per restare coerenti con l'app; qui servono concreti
// perché l'SVG reso via canvas non risolve var()/color-mix.
const C = {
  paper:   '#ffffff',   // pagina
  txt:     '#26251f',   // --txt
  sub:     '#8f8d84',   // --sub
  line:    '#eae7e1',   // --line
  head:    '#faf9f6',   // --card2 (intestazioni/righe alterne)
  wknd:    '#f1efe9',   // ombreggiatura weekend (~ --line al 40% su carta)
  accent:  '#4f8a76',   // --accent (salvia)
  hair:    '#f0ede7',   // riga interna sottile
  extra:   '#e6e3dd',   // fondo pastiglia "Extra" (collaboratore esterno): grigio chiaro
};
// Estremi della scala verdi dei tipi di turno (token --present-scale-* / --present-fg-dark, tema light).
const SH = { light: '#7cb6a0', dark: '#2c5344', fgDark: '#234438' };

const font = "font-family='-apple-system,Segoe UI,Roboto,Arial,sans-serif'";
const rect = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const line = (x1, y1, x2, y2, col = C.line, sw = 1) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="${sw}"/>`;
function text(x, y, s, { size = 12, fill = C.txt, weight = 400, anchor = 'start', italic = false } = {}) {
  return `<text x="${x}" y="${y}" ${font} font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}"${italic ? " font-style='italic'" : ''}>${esc(s)}</text>`;
}

// ---- date/etichette ----
const dayNum = d => parseInt(d.slice(8, 10), 10);
const monShort = d => MESI[parseInt(d.slice(5, 7), 10) - 1].slice(0, 3).toLowerCase();
const dow = d => GIORNI[weekdayMon0(d)];
function fmtRange(a, b) {
  if (!a) return '';
  if (a === b) return `${dayNum(a)} ${monShort(a)} ${a.slice(0, 4)}`;
  if (a.slice(0, 7) === b.slice(0, 7)) return `${dayNum(a)}–${dayNum(b)} ${monShort(b)} ${b.slice(0, 4)}`;
  return `${dayNum(a)} ${monShort(a)} – ${dayNum(b)} ${monShort(b)} ${b.slice(0, 4)}`;
}
// slug per nomi file: niente accenti/spazi problematici
function slug(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x';
}

// ---- SVG → raster (via canvas; nessuna risorsa esterna, canvas non "tainted") ----
// Ritorna { blob, imgW, imgH } con le dimensioni intrinseche (logiche × scale).
function rasterize(svg, w, h, scale, mime, quality) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
      const ctx = cv.getContext('2d');
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      cv.toBlob(b => b ? resolve({ blob: b, imgW: cv.width, imgH: cv.height }) : reject(new Error('toBlob')), mime, quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
    img.src = url;
  });
}
// SVG → JPEG (per il PDF): ritorna { jpeg:Uint8Array, imgW, imgH }.
async function svgToJpeg(svg, w, h, scale = 2) {
  const { blob, imgW, imgH } = await rasterize(svg, w, h, scale, 'image/jpeg', 0.92);
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), imgW, imgH };
}

// ---- ZIP "store" (nessuna compressione) — adattato da Zen-Staff ----
function crc32(bytes) {
  if (!crc32.t) { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } crc32.t = t; }
  let crc = -1; for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ crc32.t[(crc ^ bytes[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}
function zipStore(files) {
  const encTxt = new TextEncoder();
  const u16 = n => [n & 0xff, (n >> 8) & 0xff];
  const u32 = n => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff];
  const now = new Date();
  const dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const parts = [], central = []; let offset = 0;
  for (const f of files) {
    const name = encTxt.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const local = new Uint8Array([].concat(u32(0x04034b50), u16(20), u16(0), u16(0), u16(dt), u16(dd), u32(crc), u32(size), u32(size), u16(name.length), u16(0)));
    parts.push(local, name, f.data);
    central.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(dt), u16(dd), u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset))), name);
    offset += local.length + name.length + f.data.length;
  }
  let cenSize = 0; central.forEach(c => cenSize += c.length);
  const end = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cenSize), u32(offset), u16(0)));
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

// ================= lookup sui fatti =================
// record 'present' assegnato a (giorno·turno·ruolo) dell'azienda
function cellRecord(cid, date, shiftId, roleId) {
  return data.attendance.find(a =>
    a.companyId === cid && a.date === date && a.status === 'present' && a.shift === shiftId && a.roleId === roleId) || null;
}
// segnaposto "Extra" (collaboratore esterno) assegnato a (giorno·turno·ruolo) dell'azienda
function extraRecord(company, date, shiftId, roleId) {
  const list = Array.isArray(company?.extras) ? company.extras : [];
  return list.find(x => x.date === date && x.shift === shiftId && x.roleId === roleId) || null;
}
// turni 'present' del dipendente nel periodo (ordinati per data, poi ordine dei tipi di turno)
function employeeShifts(cid, empId, dates, shifts) {
  const dset = new Set(dates);
  const order = new Map(shifts.map((t, i) => [t.id, i]));
  return data.attendance
    .filter(a => a.companyId === cid && a.employeeId === empId && a.status === 'present' && dset.has(a.date))
    .sort((x, y) => x.date.localeCompare(y.date) || (order.get(x.shift) ?? 99) - (order.get(y.shift) ?? 99));
}
// assenze note del dipendente nel periodo (ogni status non lavorativo: ferie, malattia,
// riposo, permessi…), per la coda del prospetto. Stesso criterio della colonna "Altro"
// della griglia: tutto ciò che non è kind 'work' (il solo kind 'absence' escludeva Riposo).
function employeeAbsences(cid, empId, dates) {
  const dset = new Set(dates);
  return data.attendance
    .filter(a => a.companyId === cid && a.employeeId === empId && dset.has(a.date) && STATUSES[a.status]?.kind !== 'work')
    .sort((x, y) => x.date.localeCompare(y.date));
}
// dipendenti non al lavoro (ogni status non 'work': ferie, malattia, riposo, permessi…) in un
// giorno dell'azienda, per la colonna "Permessi" della tabella. Ordinati per nome. Solo
// dipendenti in anagrafica (anche non attivi); i "presenti fuori griglia" NON rientrano qui.
function dayAbsences(cid, date) {
  const empSet = new Set(companyEmployees(cid, { includeInactive: true }).map(e => e.id));
  return data.attendance
    .filter(a => a.companyId === cid && a.date === date && empSet.has(a.employeeId) && STATUSES[a.status]?.kind !== 'work')
    .map(a => ({ e: emp(a.employeeId), status: a.status }))
    .filter(x => x.e)
    .sort((x, y) => fullName(x.e).localeCompare(fullName(y.e)));
}

// nome per le celle della tabella: completo ('full'), solo il nome di battesimo ('first'),
// oppure l'ID/username amichevole del dipendente ('id'). In 'first' e in 'id' senza valore
// si ripiega sul nome di battesimo, e in ultima istanza sul nome completo (mai vuoto).
function cellName(e, mode) {
  if (mode === 'id') { const nk = (e.nickname || '').trim(); if (nk) return nk; const fn = (e.firstName || '').trim(); return fn || fullName(e); }
  if (mode === 'first') { const fn = (e.firstName || '').trim(); return fn || fullName(e); }
  return fullName(e);
}
// tronca una stringa a maxChars caratteri (ellissi) per non sbordare in orizzontale
function clampLabel(str, maxChars) {
  str = String(str);
  return str.length <= maxChars ? str : str.slice(0, Math.max(1, maxChars - 1)) + '…';
}

// ================= SVG: griglia turni (una pagina = un blocco di giorni) =================
function buildTableSVG(company, shifts, roles, days, meta) {
  const n = shifts.length;
  const nameMode = (meta.nameMode === 'first' || meta.nameMode === 'id') ? meta.nameMode : 'full';
  const shColors = shifts.map((_, i) => ({ bg: shiftBgHex(i, n, SH.light, SH.dark), fg: shiftFgHex(i, n, SH.fgDark) }));
  // colonna "Permessi" (assenze del giorno) in coda: larghezza fissa; i ruoli si restringono un filo se serve.
  const wDay = 78, wShift = 116, wPerm = 168;
  const wRole = Math.max(84, Math.min(148, Math.round((980 - wDay - wShift - wPerm) / Math.max(1, roles.length))));
  const gap = 6;
  const W = wDay + wShift + roles.length * wRole + wPerm;
  const padX = 22, padTop = 62, headH = 30, rowH = 26;
  const blockH = n * rowH;
  const H = padTop + headH + days.length * blockH + Math.max(0, days.length - 1) * gap + 22;
  const width = W + padX * 2;

  let s = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${H}' viewBox='0 0 ${width} ${H}'>`;
  s += rect(0, 0, width, H, C.paper);
  s += text(padX, 30, `${company.name} · Turni`, { size: 18, weight: 700 });
  s += text(padX, 48, fmtRange(meta.from, meta.to) + (meta.pages > 1 ? `   ·   pag. ${meta.page}/${meta.pages}` : ''), { size: 12, fill: C.sub });

  const x0 = padX, y0 = padTop;
  // header
  s += rect(x0, y0, W, headH, C.head);
  const cols = [['Giorno', wDay], ['Turno', wShift]].concat(roles.map(r => [r.name, wRole])).concat([['Permessi', wPerm]]);
  let cx = x0;
  cols.forEach(([label, w]) => { s += text(cx + 8, y0 + 20, label, { size: 10.5, weight: 700, fill: C.sub }); cx += w; });
  const colX = [x0]; { let vx = x0; cols.forEach(([, w]) => { vx += w; colX.push(vx); }); }
  colX.forEach(vx => s += line(vx, y0, vx, y0 + headH, C.line));
  s += line(x0, y0, x0 + W, y0, C.line);

  let y = y0 + headH;
  days.forEach((date, di) => {
    if (di > 0) { s += rect(x0, y, W, gap, C.head); y += gap; }
    const wknd = weekdayMon0(date) >= 5;
    const top = y;
    if (wknd) s += rect(x0, top, wDay, blockH, C.wknd);
    s += text(x0 + 8, top + 20, String(dayNum(date)), { size: 14, weight: 700 });
    s += text(x0 + 30, top + 20, dow(date), { size: 9.5, fill: C.sub });
    if (meta.spanMonths) s += text(x0 + 8, top + 34, monShort(date), { size: 9, fill: C.sub, weight: 700 });

    const permX = x0 + wDay + wShift + roles.length * wRole;
    shifts.forEach((t, si) => {
      const ry = top + si * rowH;
      s += `<circle cx='${x0 + wDay + 12}' cy='${ry + rowH / 2}' r='4' fill='${shColors[si].bg}'/>`;
      s += text(x0 + wDay + 22, ry + rowH / 2 + 4, t.name, { size: 10.5, weight: 600 });
      let rx = x0 + wDay + wShift;
      roles.forEach(r => {
        const rec = cellRecord(company.id, date, t.id, r.id);
        const e = rec ? emp(rec.employeeId) : null;
        if (e) {
          // cella nel COLORE del dipendente (come in griglia) con testo a contrasto; il pallino del
          // turno (scala verde) resta nella colonna "Turno".
          const bg = e.color || EMPLOYEE_COLOR_FALLBACK;
          s += rect(rx + 1, ry + 1, wRole - 2, rowH - 2, bg);
          s += text(rx + wRole / 2, ry + rowH / 2 + 4, cellName(e, nameMode), { size: 9.5, weight: 700, fill: pickTextColor(bg), anchor: 'middle' });
        } else {
          // segnaposto "Extra": cella grigio chiaro col nome dell'esterno, in corsivo per distinguerlo
          const ex = extraRecord(company, date, t.id, r.id);
          if (ex) {
            s += rect(rx + 1, ry + 1, wRole - 2, rowH - 2, C.extra);
            s += text(rx + wRole / 2, ry + rowH / 2 + 4, ex.name, { size: 9.5, weight: 600, fill: C.txt, anchor: 'middle', italic: true });
          }
        }
        rx += wRole;
      });
      // le hairline tra i turni non attraversano la colonna Permessi (blocco unico come "Giorno")
      if (si > 0) s += line(x0 + wDay, ry, permX, ry, C.hair, 1);
    });
    // colonna "Permessi": fondo neutro + elenco assenze del giorno (nome + sigla stato). Blocco a
    // rowspan sull'intero giorno; se le voci superano le righe disponibili si passa a DUE colonne
    // interne (riempite dall'alto in basso), poi si riduce il corpo; il "+N" resta solo come
    // estrema ratio se nemmeno due colonne a corpo ridotto bastano.
    s += rect(permX, top, wPerm, blockH, C.head);
    const abs = dayAbsences(company.id, date);
    if (abs.length) {
      const padV = 6, availH = blockH - padV * 2;
      let fs = 10, lineH = fs + 2.5;
      let rowsFit = Math.max(1, Math.floor(availH / lineH));
      let nCols = abs.length > rowsFit ? 2 : 1;
      if (abs.length > rowsFit * nCols) { fs = 8.5; lineH = fs + 2; rowsFit = Math.max(1, Math.floor(availH / lineH)); }
      const cap = rowsFit * nCols;
      let show = abs, overflow = 0;
      if (abs.length > cap) { show = abs.slice(0, Math.max(1, cap - 1)); overflow = abs.length - show.length; }
      const colW = (wPerm - 16) / nCols;
      const maxChars = Math.max(4, Math.floor(colW / (fs * 0.56)));
      show.forEach((a, i) => {
        const ci = Math.floor(i / rowsFit), ri = i % rowsFit;
        const nm = cellName(a.e, nameMode);
        const sigla = STATUSES[a.status]?.short || '?';
        s += text(permX + 8 + ci * colW, top + padV + fs + ri * lineH, clampLabel(`${nm} (${sigla})`, maxChars), { size: fs, fill: C.txt });
      });
      if (overflow) {
        const i = show.length, ci = Math.floor(i / rowsFit), ri = i % rowsFit;
        s += text(permX + 8 + ci * colW, top + padV + fs + ri * lineH, `+${overflow}`, { size: fs, fill: C.sub, weight: 700 });
      }
    } else {
      s += text(permX + 8, top + blockH / 2 + 4, '—', { size: 10, fill: C.sub });
    }
    colX.forEach(vx => s += line(vx, top, vx, top + blockH, C.line));
    s += line(x0, top, x0 + W, top, C.line) + line(x0, top + blockH, x0 + W, top + blockH, C.line);
    y = top + blockH;
  });
  s += '</svg>';
  return { svg: s, w: width, h: H };
}

// ================= SVG: prospetto individuale (una pagina = un blocco di righe) =================
function buildEmployeeSVG(company, e, rows, meta) {
  const wDate = 150, wShift = 250, wRole = 170;
  const W = wDate + wShift + wRole;
  const padX = 22, padTop = 70, headH = 30, rowH = 27;
  const H = padTop + headH + rows.length * rowH + (meta.tail ? meta.tail.length * 18 + 26 : 0) + 24;
  const width = W + padX * 2;

  let s = `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${H}' viewBox='0 0 ${width} ${H}'>`;
  s += rect(0, 0, width, H, C.paper);
  s += text(padX, 30, fullName(e), { size: 18, weight: 700 });
  s += text(padX, 49, `${company.name} · ${fmtRange(meta.from, meta.to)}` + (meta.pages > 1 ? `   ·   pag. ${meta.page}/${meta.pages}` : ''), { size: 12, fill: C.sub });

  const x0 = padX, y0 = padTop;
  s += rect(x0, y0, W, headH, C.head);
  s += text(x0 + 8, y0 + 20, 'Data', { size: 10.5, weight: 700, fill: C.sub });
  s += text(x0 + wDate + 8, y0 + 20, 'Turno', { size: 10.5, weight: 700, fill: C.sub });
  s += text(x0 + wDate + wShift + 8, y0 + 20, 'Ruolo', { size: 10.5, weight: 700, fill: C.sub });

  let y = y0 + headH;
  rows.forEach(r => {
    const wknd = weekdayMon0(r.date) >= 5;
    if (wknd) s += rect(x0, y, wDate, rowH, C.wknd);
    if (r.first) s += text(x0 + 8, y + rowH / 2 + 4, `${pad2(dayNum(r.date))} ${monShort(r.date)} · ${dow(r.date)}`, { size: 11.5, weight: 600 });
    s += `<circle cx='${x0 + wDate + 12}' cy='${y + rowH / 2}' r='4' fill='${r.color}'/>`;
    s += text(x0 + wDate + 22, y + rowH / 2 + 4, r.shiftLabel, { size: 11.5 });
    if (r.role || !r.absence) s += text(x0 + wDate + wShift + 8, y + rowH / 2 + 4, r.role || '—', { size: 11.5, fill: r.role ? C.txt : C.sub });
    s += line(x0, y, x0 + W, y, C.hair, 1);
    y += rowH;
  });
  s += line(x0, y0, x0 + W, y0, C.line) + line(x0, y, x0 + W, y, C.line);
  [x0, x0 + wDate, x0 + wDate + wShift, x0 + W].forEach(vx => s += line(vx, y0, vx, y, C.line));

  // coda: assenze note nel periodo (sobrio, solo se presenti e solo sull'ultima pagina)
  if (meta.tail && meta.tail.length) {
    y += 22;
    s += text(x0, y, 'Assenze nel periodo', { size: 10.5, weight: 700, fill: C.sub });
    y += 16;
    meta.tail.forEach(t => { s += text(x0, y, `• ${t}`, { size: 11, fill: C.txt }); y += 18; });
  }
  s += '</svg>';
  return { svg: s, w: width, h: H };
}

// ================= paginazione =================
// numero di giorni per pagina della tabella: si punta a ~30 righe corpo per pagina,
// senza mai spezzare un giorno; limitato tra 3 e 10.
function daysPerPage(nShifts) {
  return Math.max(3, Math.min(10, Math.floor(30 / Math.max(1, nShifts)) || 1));
}
function chunk(arr, size) {
  const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out;
}

// ================= orchestrazione: PDF tabella =================
export async function exportTablePdf(cid, dates, scale = 2) {
  const company = co(cid);
  const shifts = companyShiftTypes(company);
  const roles = companyRoles(company);
  const from = dates[0], to = dates[dates.length - 1];
  const spanMonths = new Set(dates.map(d => d.slice(0, 7))).size > 1;
  const groups = chunk(dates, daysPerPage(shifts.length));
  const pages = [];
  for (let i = 0; i < groups.length; i++) {
    // il PDF resta sempre a nomi completi
    const { svg, w, h } = buildTableSVG(company, shifts, roles, groups[i], { from, to, spanMonths, page: i + 1, pages: groups.length, nameMode: 'full' });
    const { jpeg, imgW, imgH } = await svgToJpeg(svg, w, h, scale);
    pages.push({ jpeg, imgW, imgH, pageW: PAGE.a4landscape.w, pageH: PAGE.a4landscape.h, margin: 24 });
  }
  return { blob: jpegPagesToPdf(pages), name: `turni_${slug(company.name)}_${from}_${to}.pdf` };
}

// ================= orchestrazione: PNG tabella (immagine intera, non paginata) =================
// Stessa griglia del PDF ma in un'unica immagine alta quanto serve (come Zen-Staff).
// nameMode: 'full' (default) mostra nome e cognome; 'first' solo il nome di battesimo;
// 'id' l'ID/username amichevole (fallback al nome di battesimo se vuoto).
export async function exportTablePng(cid, dates, scale = 2, nameMode = 'full') {
  const company = co(cid);
  const shifts = companyShiftTypes(company);
  const roles = companyRoles(company);
  const from = dates[0], to = dates[dates.length - 1];
  const spanMonths = new Set(dates.map(d => d.slice(0, 7))).size > 1;
  const { svg, w, h } = buildTableSVG(company, shifts, roles, dates, { from, to, spanMonths, page: 1, pages: 1, nameMode });
  const { blob } = await rasterize(svg, w, h, scale, 'image/png');
  const suffix = nameMode === 'first' ? '_nomi' : nameMode === 'id' ? '_id' : '';
  return { blob, name: `turni_${slug(company.name)}_${from}_${to}${suffix}.png` };
}

// ================= orchestrazione: ZIP di prospetti individuali (PDF o PNG) =================
// format 'pdf' (default): un PDF A4 paginato per dipendente; 'png': un'unica immagine intera.
export async function exportEmployeesZip(cid, dates, scale = 2, format = 'pdf') {
  const company = co(cid);
  const shifts = companyShiftTypes(company);
  const from = dates[0], to = dates[dates.length - 1];
  // dipendenti con almeno un turno O un'assenza nel periodo (anche non attivi, se assegnati)
  const emps = companyEmployees(cid, { includeInactive: true })
    .filter(e => employeeShifts(cid, e.id, dates, shifts).length || employeeAbsences(cid, e.id, dates).length);

  const files = [];
  const used = new Set();
  const ROWS_PER_PAGE = 26;
  for (const e of emps) {
    // righe del prospetto: turni E assenze in un'unica lista per data. Le assenze (ferie,
    // malattia, riposo…) compaiono con l'etichetta dello stato nella colonna Turno e la
    // cella Ruolo vuota — niente più coda "Assenze nel periodo" in fondo.
    const shiftOrder = new Map(shifts.map((t, i) => [t.id, i]));
    const entries = [
      ...employeeShifts(cid, e.id, dates, shifts).map(a => ({ a, abs: false })),
      ...employeeAbsences(cid, e.id, dates).map(a => ({ a, abs: true })),
    ].sort((x, y) => x.a.date.localeCompare(y.a.date) ||
      (x.abs ? 99 : (shiftOrder.get(x.a.shift) ?? 98)) - (y.abs ? 99 : (shiftOrder.get(y.a.shift) ?? 98)));
    const rows = [];
    let prevDate = null;
    entries.forEach(({ a, abs }) => {
      if (abs) {
        const st = STATUSES[a.status];
        rows.push({ date: a.date, first: a.date !== prevDate, shiftLabel: st?.label || a.status, role: '', absence: true, color: st?.color || C.sub });
      } else {
        const t = shiftTypeById(company, a.shift);
        const r = roleById(company, a.roleId);
        const i = shifts.findIndex(x => x.id === a.shift);
        rows.push({ date: a.date, first: a.date !== prevDate, shiftLabel: t ? t.name : '—', role: r?.name || '', color: i >= 0 ? shiftBgHex(i, shifts.length, SH.light, SH.dark) : C.sub });
      }
      prevDate = a.date;
    });

    let bytes;
    if (format === 'png') {
      // immagine unica alta quanto serve (niente paginazione), come il PNG tabella
      const { svg, w, h } = buildEmployeeSVG(company, e, rows, { from, to, page: 1, pages: 1, tail: null });
      const { blob } = await rasterize(svg, w, h, scale, 'image/png');
      bytes = new Uint8Array(await blob.arrayBuffer());
    } else {
      const groups = chunk(rows, ROWS_PER_PAGE);
      const pages = [];
      for (let i = 0; i < groups.length; i++) {
        const { svg, w, h } = buildEmployeeSVG(company, e, groups[i], { from, to, page: i + 1, pages: groups.length, tail: null });
        const { jpeg, imgW, imgH } = await svgToJpeg(svg, w, h, scale);
        pages.push({ jpeg, imgW, imgH, pageW: PAGE.a4portrait.w, pageH: PAGE.a4portrait.h, margin: 32 });
      }
      bytes = buildPdfBytes(pages);
    }
    const ext = format === 'png' ? 'png' : 'pdf';
    let name = `turni_${slug(fullName(e))}_${from}_${to}.${ext}`;
    let k = 2; while (used.has(name)) name = `turni_${slug(fullName(e))}_${k++}_${from}_${to}.${ext}`;
    used.add(name);
    files.push({ name, data: bytes });
  }
  return { blob: zipStore(files), count: files.length, name: `turni-dipendenti_${slug(company.name)}_${from}_${to}.zip` };
}
