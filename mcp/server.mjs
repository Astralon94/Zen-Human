#!/usr/bin/env node
// ============ Zen-Human · Server MCP (SOLA LETTURA) ============
// Espone i dati di Zen-Human a un assistente AI (es. Claude Desktop) tramite il
// Model Context Protocol, su stdio. Caratteristiche volute per la famiglia Zen:
//   • ZERO dipendenze: il protocollo JSON-RPC (newline-delimited) è gestito a mano.
//   • SOLA LETTURA: non scrive mai. Legge lo stato via GET /api/data del server locale.
//   • VERITÀ DEI DATI: RIUSA la logica di dominio REALE dell'app (src/domain/*) iniettando
//     il payload del boot nel singleton `data`. Così i valori derivati (netto mensile,
//     conteggi presenze, scadenze, residui prestiti) coincidono ESATTAMENTE con quelli
//     mostrati dall'app, senza reimplementare formule che potrebbero divergere.
//
// Config env:  ZEN_HUMAN_URL (default http://localhost:4332)
// Avvio manuale (debug):  node mcp/server.mjs   (parla JSON-RPC su stdin/stdout)

import { data } from '../src/state/store.js';
import { migrate } from '../src/state/model.js';
import { fullName, thisMonth, fmtMonth } from '../src/domain/util.js';
import {
  co, emp, companyEmployees, salaryFor, monthlyNet, nettoConsulente,
  attendanceStats, entriesSum, shiftBonusSum, loanResiduo, loanPaid,
} from '../src/domain/payroll.js';
import { companyDeadlines, employeeDeadlines, deadlineTone, deadlineLabel } from '../src/domain/deadlines.js';

const BASE = process.env.ZEN_HUMAN_URL || 'http://localhost:4332';
const VERSION = '0.1.0';
const eur = n => Math.round(n * 100) / 100;

// ---- Caricamento dati: fresh a ogni chiamata (la verità è il DB del server) ----
// Non riassegna il binding `data` (non si può da fuori): ne muta le PROPRIETÀ, così i
// moduli di dominio — che leggono lo stesso oggetto — vedono i dati aggiornati.
async function loadData() {
  const res = await fetch(BASE + '/api/data');
  if (!res.ok) throw new Error(`HTTP ${res.status} da ${BASE}/api/data`);
  const payload = migrate(await res.json());
  for (const k of Object.keys(payload)) data[k] = payload[k];
}

// ---- Risoluzione azienda: id esatto, nome (match parziale), oppure vuoto/"tutte" → null ----
function resolveScope(arg) {
  if (arg == null || /^\s*(tutte|tutti|all|)\s*$/i.test(String(arg))) return null;
  const byId = data.companies.find(c => c.id === arg);
  if (byId) return byId.id;
  const q = String(arg).trim().toLowerCase();
  const byName = data.companies.find(c => (c.name || '').toLowerCase().includes(q));
  if (byName) return byName.id;
  throw new Error(`Azienda non trovata: "${arg}". Disponibili: ${data.companies.map(c => c.name).join(', ')}`);
}
const scopeName = s => (s ? (co(s)?.name || s) : 'Tutte le aziende');

// aziende su cui iterare in base allo scope (una sola, oppure tutte)
const companiesInScope = scope => (scope ? [co(scope)].filter(Boolean) : data.companies);

// mese valido "YYYY-MM": usa quello passato o il corrente
const monthArg = m => (/^\d{4}-\d{2}$/.test(String(m || '')) ? m : thisMonth());

// vista sintetica di un dipendente (identità + azienda)
const empBrief = e => ({
  id: e.id,
  nome: fullName(e),
  azienda: co(e.companyId)?.name || null,
  mansione: e.role || null,
  stato: e.active === false ? 'cessato' : 'attivo',
});

// ============ Strumenti (tutti in sola lettura) ============
const TOOLS = {
  lista_aziende: {
    description: 'Elenca le aziende gestite in Zen-Human (id, nome, emoji, numero di dipendenti attivi). Usalo per sapere su quale azienda filtrare le altre richieste.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => data.companies.map(c => ({
      id: c.id,
      nome: c.name,
      emoji: c.emoji || null,
      dipendentiAttivi: companyEmployees(c.id).length,
    })),
  },

  lista_dipendenti: {
    description: "Elenca i dipendenti con filtri per azienda e stato. Per ciascuno: azienda, mansione, tipo contratto, stato (attivo/cessato) e netto pattuito vigente nel mese indicato.",
    inputSchema: {
      type: 'object',
      properties: {
        azienda: { type: 'string', description: 'nome o id azienda; vuoto o "tutte" = tutte le aziende' },
        stato: { type: 'string', enum: ['attivi', 'cessati', 'tutti'], description: 'default: attivi' },
        mese: { type: 'string', description: 'mese "YYYY-MM" per il netto pattuito; default mese corrente' },
      },
      additionalProperties: false,
    },
    run: ({ azienda, stato = 'attivi', mese } = {}) => {
      const scope = resolveScope(azienda);
      const month = monthArg(mese);
      const includeInactive = stato !== 'attivi';
      const rows = [];
      companiesInScope(scope).forEach(c => {
        companyEmployees(c.id, { includeInactive }).forEach(e => {
          if (stato === 'cessati' && e.active !== false) return;
          rows.push({
            ...empBrief(e),
            contratto: e.contract || null,
            nettoPattuito: salaryFor(e, month),
          });
        });
      });
      return { azienda: scopeName(scope), mese: fmtMonth(month), totali: rows.length, dipendenti: rows };
    },
  },

  riepilogo: {
    description: "KPI HR di un'azienda (o di tutte) per il mese indicato: numero di dipendenti attivi, giorni lavorati e assenze totali, netto totale da liquidare e scadenze (contratti/libretti) scadute o in scadenza. Rispecchia la vista Riepilogo e Scadenze dell'app.",
    inputSchema: {
      type: 'object',
      properties: {
        azienda: { type: 'string', description: 'nome o id azienda; vuoto o "tutte" = tutte le aziende' },
        mese: { type: 'string', description: 'mese "YYYY-MM"; default mese corrente' },
      },
      additionalProperties: false,
    },
    run: ({ azienda, mese } = {}) => {
      const scope = resolveScope(azienda);
      const month = monthArg(mese);
      let dipendenti = 0, worked = 0, absences = 0, nettoTotale = 0, spettanteTotale = 0;
      let scadute = 0, inScadenza = 0;
      companiesInScope(scope).forEach(c => {
        companyEmployees(c.id).forEach(e => {
          dipendenti++;
          const st = attendanceStats(e, month);
          worked += st.worked; absences += st.absences;
          nettoTotale += monthlyNet(e, month).net;
          spettanteTotale += nettoConsulente(e, month).spettante;
        });
        companyDeadlines(c.id).forEach(d => {
          const lvl = deadlineTone(d.days, d.warnAt).level;
          if (lvl === 'expired') scadute++;
          else if (lvl === 'soon') inScadenza++;
        });
      });
      return {
        azienda: scopeName(scope),
        mese: fmtMonth(month),
        dipendentiAttivi: dipendenti,
        giorniLavorati: worked,
        assenze: absences,
        nettoTotaleDaLiquidare: eur(nettoTotale),
        totaleBusteSpettante: eur(spettanteTotale),
        scadenzeScadute: scadute,
        scadenzeInScadenza: inScadenza,
      };
    },
  },

  scadenze: {
    description: 'Scadenze dei dipendenti (contratti a termine e libretti sanitari) ordinate per data crescente: le scadute e le più imminenti finiscono in cima. Rispecchia la vista Scadenze. Con "giorni" limiti la finestra futura; le già scadute sono sempre incluse.',
    inputSchema: {
      type: 'object',
      properties: {
        azienda: { type: 'string', description: 'nome o id azienda; vuoto = tutte' },
        tipo: { type: 'string', enum: ['contract', 'libretto', 'tutte'], description: 'tipo di scadenza; default tutte' },
        giorni: { type: 'integer', description: 'finestra in giorni da oggi; se omesso, tutte le scadenze' },
        includiCessati: { type: 'boolean', description: 'includi i dipendenti cessati (default false)' },
        limite: { type: 'integer', description: 'max scadenze restituite (default 50)' },
      },
      additionalProperties: false,
    },
    run: ({ azienda, tipo = 'tutte', giorni, includiCessati = false, limite = 50 } = {}) => {
      const scope = resolveScope(azienda);
      let rows = [];
      companiesInScope(scope).forEach(c => {
        companyDeadlines(c.id, { includeInactive: includiCessati }).forEach(d => rows.push(d));
      });
      if (tipo !== 'tutte') rows = rows.filter(d => d.type === tipo);
      if (giorni != null) rows = rows.filter(d => d.days != null && d.days <= giorni);
      rows.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      const scadute = rows.filter(d => deadlineTone(d.days, d.warnAt).level === 'expired').length;
      const inScadenza = rows.filter(d => deadlineTone(d.days, d.warnAt).level === 'soon').length;
      const out = rows.slice(0, Math.max(1, limite)).map(d => ({
        dipendente: fullName(d.employee),
        azienda: co(d.employee.companyId)?.name || null,
        tipo: d.label,
        scadenza: d.date,
        stato: deadlineLabel(d.days),
        livello: deadlineTone(d.days, d.warnAt).level, // expired | soon | ok
        ...(d.employee.active === false ? { cessato: true } : {}),
      }));
      return { azienda: scopeName(scope), totali: rows.length, scadute, inScadenza, mostrate: out.length, scadenze: out };
    },
  },

  dettaglio_dipendente: {
    description: 'Scheda completa di un dipendente (match parziale sul nome, oppure id): identità, contratto, scomposizione del netto del mese (pattuito, bonus, sanzioni, acconti, rate prestiti, assenze), voci del mese, scadenze attive e prestiti in corso con residuo.',
    inputSchema: {
      type: 'object',
      properties: {
        dipendente: { type: 'string', description: 'nome (anche parziale) o id del dipendente' },
        azienda: { type: 'string', description: 'restringe la ricerca a una azienda' },
        mese: { type: 'string', description: 'mese "YYYY-MM"; default mese corrente' },
      },
      required: ['dipendente'],
      additionalProperties: false,
    },
    run: ({ dipendente, azienda, mese } = {}) => {
      const scope = resolveScope(azienda);
      const month = monthArg(mese);
      const q = String(dipendente || '').trim().toLowerCase();
      let pool = scope ? companyEmployees(scope, { includeInactive: true }) : data.employees;
      const byId = pool.find(e => e.id === dipendente);
      const matches = byId ? [byId] : pool.filter(e => fullName(e).toLowerCase().includes(q));
      if (!matches.length) return { messaggio: `Nessun dipendente che corrisponde a "${dipendente}".` };
      if (matches.length > 1) {
        return { messaggio: `Più dipendenti corrispondono a "${dipendente}". Specifica meglio.`, candidati: matches.map(empBrief) };
      }
      const e = matches[0];
      const n = monthlyNet(e, month);
      const cons = nettoConsulente(e, month);
      const st = attendanceStats(e, month);
      const deadlines = employeeDeadlines(e).map(d => ({
        tipo: d.label, scadenza: d.date, stato: deadlineLabel(d.days), livello: deadlineTone(d.days, d.warnAt).level,
      }));
      const prestiti = (e.loans || []).map(l => ({
        nome: l.name || null, totale: eur(Number(l.total) || 0),
        residuo: loanResiduo(l), pagato: loanPaid(l),
        rate: (l.plan || []).length, note: l.notes || null,
      }));
      return {
        ...empBrief(e),
        contratto: e.contract || null,
        contrattoScadenza: e.contractOpen ? 'tempo indeterminato' : (e.contractEnd || null),
        librettoSanitario: e.librettoSanitario || null,
        mese: fmtMonth(month),
        nettoDelMese: {
          pattuito: n.base, bonus: n.bonus, bonusTurni: n.shiftBonus,
          sanzioni: n.sanctions, acconti: n.advances, ratePrestiti: n.loans,
          trattenuteAssenze: n.absences, netto: n.net,
        },
        prospettoConsulente: { bustaSpettante: cons.spettante, anticipato: cons.anticipato, residuo: cons.residuo },
        presenze: { lavorati: st.worked, assenze: st.absences, giorniMarcati: st.marked, conteggi: st.counts },
        scadenze: deadlines,
        prestiti,
        noteConsulente: (e.noteConsultant || '').trim() || null,
      };
    },
  },

  voci_economiche: {
    description: 'Bonus, sanzioni e acconti registrati per un mese (voci economiche della vista omonima). Filtrabili per azienda, tipo e dipendente. Restituisce le voci con dipendente, importo, data e descrizione, più i totali per tipo.',
    inputSchema: {
      type: 'object',
      properties: {
        azienda: { type: 'string', description: 'nome o id azienda; vuoto = tutte' },
        mese: { type: 'string', description: 'mese "YYYY-MM"; default mese corrente' },
        tipo: { type: 'string', enum: ['bonus', 'sanction', 'advance', 'tutti'], description: 'default tutti' },
        dipendente: { type: 'string', description: 'nome (anche parziale) del dipendente' },
        limite: { type: 'integer', description: 'max voci restituite (default 50)' },
      },
      additionalProperties: false,
    },
    run: ({ azienda, mese, tipo = 'tutti', dipendente, limite = 50 } = {}) => {
      const scope = resolveScope(azienda);
      const month = monthArg(mese);
      const KINDS = ['bonus', 'sanction', 'advance'];
      const inScope = new Set(companiesInScope(scope).map(c => c.id));
      let list = data.entries.filter(x => inScope.has(x.companyId) && x.month === month && KINDS.includes(x.kind));
      if (tipo !== 'tutti') list = list.filter(x => x.kind === tipo);
      if (dipendente) {
        const q = String(dipendente).toLowerCase();
        list = list.filter(x => { const e = emp(x.employeeId); return e && fullName(e).toLowerCase().includes(q); });
      }
      list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || (b.date || '').localeCompare(a.date || ''));
      const KLAB = { bonus: 'Bonus', sanction: 'Sanzione', advance: 'Acconto' };
      const sumOf = k => eur(list.filter(x => x.kind === k).reduce((s, x) => s + (Number(x.amount) || 0), 0));
      const rows = list.slice(0, Math.max(1, limite)).map(x => {
        const e = emp(x.employeeId);
        return {
          dipendente: e ? fullName(e) : 'Dipendente rimosso',
          azienda: co(x.companyId)?.name || null,
          tipo: KLAB[x.kind] || x.kind,
          importo: eur(Number(x.amount) || 0),
          data: x.date || null,
          descrizione: x.desc || null,
        };
      });
      return {
        azienda: scopeName(scope),
        mese: fmtMonth(month),
        totali: list.length,
        totaleBonus: sumOf('bonus'),
        totaleSanzioni: sumOf('sanction'),
        totaleAcconti: sumOf('advance'),
        mostrate: rows.length,
        voci: rows,
      };
    },
  },
};

// ============ Trasporto MCP: JSON-RPC 2.0, messaggi newline-delimited su stdio ============
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const replyError = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'zen-human', version: VERSION },
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return; // notifiche: nessuna risposta
    case 'ping':
      return reply(id, {});
    case 'resources/list':
      return reply(id, { resources: [] });
    case 'prompts/list':
      return reply(id, { prompts: [] });
    case 'tools/list':
      return reply(id, { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const name = params?.name;
      const tool = TOOLS[name];
      if (!tool) return replyError(id, -32602, `Strumento sconosciuto: ${name}`);
      try {
        await loadData();
        const out = await tool.run(params?.arguments || {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        const hint = /fetch failed|ECONNREFUSED|HTTP \d|networkerror/i.test(String(e.message))
          ? ` — Zen-Human non raggiungibile su ${BASE}. Avvia i server (avvia-zen.command).` : '';
        return reply(id, { content: [{ type: 'text', text: `Errore: ${e.message}${hint}` }], isError: true });
      }
    }
    default:
      if (id !== undefined) return replyError(id, -32601, `Metodo non supportato: ${method}`);
  }
}

// ---- Lettura stdin (newline-delimited) ----
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    Promise.resolve(handle(msg)).catch(e => { if (msg && msg.id !== undefined) replyError(msg.id, -32603, String(e.message)); });
  }
});
process.stdin.on('end', () => process.exit(0));

// Diagnostica SOLO su stderr: qualsiasi output su stdout romperebbe il protocollo.
process.stderr.write(`[zen-human-mcp] avviato · sorgente dati ${BASE}\n`);
