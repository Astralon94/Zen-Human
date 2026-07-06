# Zen Human — versione server (sperimentale)

App per il tracciamento di **presenze, assenze, voci economiche** e per la generazione del
**prospetto da inviare al consulente del lavoro**. **100% locale**, niente cloud, niente account.

> **Variante `-server`.** A differenza dell'originale (Vite + File System Access API, solo Chrome),
> questa versione gira su un **server locale Node** (`node:http`) con un **database relazionale
> `node:sqlite`** (zero dipendenze a runtime). Il frontend resta la stessa SPA, ma persiste via API
> (`/api/data`, `/api/changes`) invece che su cartella del disco. I dati vivono in
> `data/zenhuman.db`, con backup automatici in `data/backups/`.

## Cosa fa

**Base multi-azienda**
- Aziende con dati completamente separati (P.IVA, CF, note).
- Database di dipendenti diviso per azienda; selettore azienda nella topbar.

**Scheda dipendente**
- Anagrafica base (nome, cognome, mansione, colore, stato attivo/cessato) e scadenze contratto/libretto.
- **Stipendio netto pattuito storicizzato per mese**: ogni mese può avere un valore diverso.
- **Calendario presenze giornaliero**: stato per giorno (Presente, Ferie, Malattia, Infortunio, Permesso ROL, Permesso non retribuito, Riposo) con turno e bonus turno.
- Per ogni assenza/permesso un **importo da scalare** dal netto (manuale).
- **Voci del mese**: bonus (+), sanzioni (−), acconti (−).
- **Prestiti rateizzati**: piano rate con residuo; ogni rata si può segnare pagata o saltare.

**Riepilogo (prospetto per il consulente)**
- Tabella mensile per azienda: giorni lavorati, assenze per tipo, netto per dipendente, totali.
- Netto calcolato: `pattuito + bonus − sanzioni − acconti − rate prestiti − trattenute assenze`.
- Stato e totali sono **sempre calcolati, mai salvati**.
- **Export PDF** (consulente/interno) e **Export CSV**.

**Altro**: tema chiaro/scuro, **backup/ripristino JSON** dalle Impostazioni. Gestione **aziende** dentro Impostazioni.

## Architettura

Server Node (zero dipendenze a runtime) + SPA. Il frontend resta modulare in `src/`,
buildato con Vite in un **`index.html` self-contained** servito dal server da `public/`.

```
server.js          server node:http — statico da public/ + API /api
server/
  schema.js        specifica tabelle (colonne indicizzate + doc JSON verbatim)
  db.js            connessione node:sqlite, WAL + foreign_keys, DDL, backup
  serialize.js     import/export + applyChanges (transazionale, lossless)
scripts/           reset.mjs, roundtrip.mjs (test), import-vault.mjs
src/               frontend (invariato salvo state/store.js → API)
  state/     model.js (dati, stati presenza, migrazioni), store.js (persistenza via API)
  domain/    util.js, payroll.js (stipendio, presenze, prestiti, netto)
  ui/        app.js (shell+router), views/ (riepilogo, compilazione, bonus-sanzioni, dipendenti, scadenze, impostazioni, aziende)
data/              zenhuman.db (+ backups/) — NON versionato
```

## Persistenza e integrità
Fonte di verità: il **DB SQLite** del server. Modello **ibrido documento-relazionale**: ogni entità ha
colonne tipizzate/indicizzate per le query **più** una colonna `doc` con il JSON verbatim → export
lossless per costruzione. `employees` porta `salaries[]` e `loans[]` (con `plan[]`) annidati nel proprio
doc. `WAL` + `foreign_keys`, import **transazionale** con backup del DB, `rev` **monotòno**.
Il `save()` invia solo i record cambiati (**changeset granulare** su `/api/changes`).

## Comandi
```bash
npm install          # dipendenze SOLO di build (vite)
npm run build        # builda il frontend → public/index.html
npm start            # avvia il server → http://localhost:4332
npm run reset-db     # riporta il DB ai dati di default (con backup)
npm run test:roundtrip  # test d'integrità (in memoria)
```

## Uso
1. `npm install && npm run build` (la prima volta, e dopo ogni modifica al frontend)
2. `npm start` → apri **http://localhost:4332**

Backup/trasferimento dati: Impostazioni → *Esporta backup* / *Importa backup* (JSON),
compatibile con l'export dell'app originale.
