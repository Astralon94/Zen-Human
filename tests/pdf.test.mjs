// Test strutturale del writer PDF puro (domain/pdf.js), eseguibile in Node.
// Non rende SVG/canvas: usa un JPEG fittizio e verifica che il PDF prodotto sia
// ben formato (header, xref coerente con gli oggetti, trailer, startxref, %%EOF).
// Lancia con `node tests/pdf.test.mjs` oppure `node --test tests/pdf.test.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPdfBytes, PAGE } from '../src/domain/pdf.js';

// "JPEG" fittizio: bastano dei byte (il writer non li interpreta, li impacchetta come /DCTDecode).
const fakeJpeg = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0xFF, 0xD9]);
const mkPage = () => ({ jpeg: fakeJpeg, imgW: 800, imgH: 600, pageW: PAGE.a4landscape.w, pageH: PAGE.a4landscape.h, margin: 24 });
const ascii = bytes => Buffer.from(bytes).toString('latin1');

function checkPdf(bytes, nPages) {
  const s = ascii(bytes);
  assert.ok(s.startsWith('%PDF-1.4'), 'header %PDF-1.4');
  assert.ok(s.includes('/Type /Catalog'), 'catalog presente');
  assert.match(s, new RegExp(`/Type /Pages /Count ${nPages}`), 'count pagine coerente');
  assert.equal((s.match(/\/Subtype \/Image/g) || []).length, nPages, 'una immagine per pagina');
  assert.ok(s.trimEnd().endsWith('%%EOF'), 'termina con %%EOF');

  // startxref deve puntare all'inizio della tabella xref
  const m = /startxref\s+(\d+)\s+%%EOF/.exec(s);
  assert.ok(m, 'startxref presente');
  const xrefOff = Number(m[1]);
  assert.equal(ascii(bytes.slice(xrefOff, xrefOff + 4)), 'xref', 'startxref punta a "xref"');

  // Size del trailer = nObjs+1, e la tabella xref elenca esattamente quelle voci
  const nObjs = 2 + nPages * 3;
  assert.match(s, new RegExp(`/Size ${nObjs + 1}\\b`), 'trailer /Size coerente');
  const xh = new RegExp(`xref\\s+0 ${nObjs + 1}\\b`);
  assert.match(s, xh, 'intestazione xref coerente');
  const entries = s.slice(s.indexOf('xref')).match(/^\d{10} \d{5} [nf] $/gm) || [];
  assert.equal(entries.length, nObjs + 1, 'numero voci xref = oggetti + 1');
}

test('PDF a pagina singola: struttura valida', () => {
  checkPdf(buildPdfBytes([mkPage()]), 1);
});

test('PDF multipagina: struttura valida', () => {
  checkPdf(buildPdfBytes([mkPage(), mkPage(), mkPage()]), 3);
});

test('xref: gli offset puntano davvero all\'inizio degli oggetti', () => {
  const bytes = buildPdfBytes([mkPage(), mkPage()]);
  const s = ascii(bytes);
  const xrefOff = Number(/startxref\s+(\d+)/.exec(s)[1]);
  const lines = s.slice(xrefOff).split('\n');
  // lines[0]='xref', [1]='0 N', [2]=voce obj0 (f), [3..]=voci n con offset
  const nObjs = 2 + 2 * 3;
  for (let obj = 1; obj <= nObjs; obj++) {
    const off = Number(lines[2 + obj].slice(0, 10));
    assert.equal(ascii(bytes.slice(off, off + `${obj} 0 obj`.length)), `${obj} 0 obj`, `offset obj ${obj}`);
  }
});
