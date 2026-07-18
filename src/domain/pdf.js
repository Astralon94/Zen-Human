// ============ Writer PDF 1.4 minimale, zero dipendenze ============
// Scrive un PDF che incapsula una o più immagini JPEG (una per pagina), ciascuna
// disegnata come XObject con filtro /DCTDecode. È un writer "a mano" (catalog →
// pages → page/contents/image, xref esplicita) pensato per l'export della sezione
// Turni senza librerie esterne. La parte di SCRITTURA è PURA (solo byte, niente
// canvas/DOM), quindi è importabile anche in Node per i test strutturali; il
// rendering SVG→canvas→JPEG vive invece in domain/turni-export.js (solo browser).

// Formato pagina A4 in punti tipografici (1pt = 1/72"): 210×297mm.
const A4_W = 595.28, A4_H = 841.89;
export const PAGE = {
  a4portrait:  { w: A4_W, h: A4_H },
  a4landscape: { w: A4_H, h: A4_W },
};

// stringa ASCII/latin1 → byte (i JPEG restano binari, quindi si lavora sempre su byte)
function enc(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
function concat(chunks) {
  let len = 0; for (const c of chunks) len += c.length;
  const out = new Uint8Array(len); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

// pages: [{ jpeg:Uint8Array, imgW, imgH, pageW, pageH, margin }]
//   jpeg          = byte del JPEG (già compresso)
//   imgW/imgH     = dimensioni intrinseche in pixel del JPEG
//   pageW/pageH   = dimensioni della pagina in punti (vedi PAGE)
//   margin        = margine in punti; l'immagine è scalata per stare nei margini
//                   mantenendo le proporzioni e ancorata in alto.
// Ritorna i byte grezzi del PDF (Uint8Array). Testabile in Node.
export function buildPdfBytes(pages) {
  const chunks = [];
  let offset = 0;
  const offsets = [];                        // offsets[objNum] = offset in byte dell'oggetto
  const push = bytes => { chunks.push(bytes); offset += bytes.length; };
  const pushStr = s => push(enc(s));
  const startObj = num => { offsets[num] = offset; };

  pushStr('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));   // commento binario (marca il file come binario)

  const nPages = pages.length;
  const kids = [];
  for (let i = 0; i < nPages; i++) kids.push(`${3 + i * 3} 0 R`);

  // 1: Catalog — 2: Pages
  startObj(1);
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2);
  pushStr(`2 0 obj\n<< /Type /Pages /Count ${nPages} /Kids [${kids.join(' ')}] >>\nendobj\n`);

  pages.forEach((p, i) => {
    const pageNum = 3 + i * 3, contentNum = 4 + i * 3, imgNum = 5 + i * 3;
    const pw = p.pageW, ph = p.pageH, m = p.margin ?? 0;
    // fit dell'immagine nei margini, proporzioni preservate, ancoraggio in alto
    const availW = pw - 2 * m, availH = ph - 2 * m;
    const scale = Math.min(availW / p.imgW, availH / p.imgH);
    const dw = p.imgW * scale, dh = p.imgH * scale;
    const dx = (pw - dw) / 2;                 // centrata in orizzontale
    const dy = ph - m - dh;                   // ancorata in alto
    const content = `q ${dw.toFixed(2)} 0 0 ${dh.toFixed(2)} ${dx.toFixed(2)} ${dy.toFixed(2)} cm /Im0 Do Q\n`;
    const contentBytes = enc(content);

    startObj(pageNum);
    pushStr(`${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Resources << /XObject << /Im0 ${imgNum} 0 R >> >> /Contents ${contentNum} 0 R >>\nendobj\n`);
    startObj(contentNum);
    pushStr(`${contentNum} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    pushStr('\nendstream\nendobj\n');
    startObj(imgNum);
    pushStr(`${imgNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.imgW} /Height ${p.imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg);
    pushStr('\nendstream\nendobj\n');
  });

  // tabella xref (obj 0 = testa libera, poi ogni oggetto in ordine)
  const nObjs = 2 + nPages * 3;
  const xrefStart = offset;
  let xref = `xref\n0 ${nObjs + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= nObjs; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  pushStr(xref);
  pushStr(`trailer\n<< /Size ${nObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  return concat(chunks);
}

// Comodità browser: impacchetta le pagine JPEG in un Blob application/pdf.
export function jpegPagesToPdf(pages) {
  return new Blob([buildPdfBytes(pages)], { type: 'application/pdf' });
}
