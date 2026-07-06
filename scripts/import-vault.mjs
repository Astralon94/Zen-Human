// Importa i dati reali dal vault FSA nel DB del server (Zen-Human).
// Il JSON di Zen-Human è COMPLETO (niente XML/allegati separati): import diretto, transazionale.
// Uso: node scripts/import-vault.mjs "<percorso-zen-human.json>"
import { readFileSync } from 'node:fs';
import { importData } from '../server/serialize.js';

const file = process.argv[2];
if (!file) { console.error('Uso: node scripts/import-vault.mjs "<percorso-zen-human.json>"'); process.exit(1); }

const data = JSON.parse(readFileSync(file, 'utf8'));
const r = importData(data, { force: true });
console.log('Import OK — rev', r.rev);
console.log('Conteggi:', JSON.stringify(r.counts));
