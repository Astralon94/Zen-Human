# Zen Human

Gestione del personale **self-hosted e 100% locale**: presenze, pianificazione turni, voci economiche e prospetto mensile per il consulente del lavoro. Niente cloud, niente abbonamenti: un server Node **senza dipendenze a runtime** e un database SQLite in un singolo file.

## Caratteristiche

- **Multi-azienda** — aziende con dati completamente separati; selettore in topbar.
- **Presenze** — matrice mensile dipendenti × giorni compilabile "a pennello": stati (presente, ferie, malattia, infortunio, permessi, riposo), tipo di turno con gradazioni di colore, flag di **conferma** (le presenze pianificate nascono da confermare), chiusura del mese.
- **Turni** — griglia di pianificazione settimanale o per periodo libero (giorni × tipi di turno sulle righe, **ruoli** sulle colonne): assegnazione a pennello, drag & drop per spostare e scambiare, segnaposto testuali per collaboratori esterni, elenco degli assenti e dei "da inserire" per giorno. Ruoli e tipi di turno (nome e orari) sono configurabili per azienda.
- **Export turni** — PDF della tabella (A4, multipagina), PNG (anche con soli nomi o con gli ID/username dei dipendenti) e ZIP con il prospetto individuale per ogni dipendente (PDF o PNG), pronto da inviare.
- **Scheda dipendente** — anagrafica con colore e ID/username, scadenze contratto/libretto, **stipendio pattuito storicizzato per mese**, voci del mese (bonus, sanzioni, acconti), **prestiti rateizzati** con piano rate.
- **Dashboard (prospetto consulente)** — tabella mensile con giorni lavorati, assenze per tipo e netto per dipendente (`pattuito + bonus − sanzioni − acconti − rate prestiti − trattenute assenze`); stati e totali **sempre calcolati, mai salvati**. Export **PDF** e **CSV**.
- **Multi-utente** — login con permessi granulari per sezione e azione (presenze, turni, retribuzioni, anagrafiche…).
- **Aggiornamenti in-app** — l'app controlla le release di questo repository e si aggiorna da sola (vedi sotto).

## Requisiti

- **Node.js ≥ 22.5** (usa il modulo nativo `node:sqlite`; consigliata l'ultima LTS).
- Nessuna dipendenza a runtime: `npm install` serve solo per lo sviluppo del frontend.

## Avvio rapido

```bash
git clone https://github.com/Astralon94/Zen-Human.git
cd Zen-Human
npm start            # avvia il server su http://localhost:4332
```

Al primo avvio viene creato l'utente **admin / admin**: cambiare subito la password (Impostazioni → Utenti). La porta si cambia con `PORT=8080 npm start`.

I dati vivono in `data/zenhuman.db` (creato al primo avvio, con backup automatici in `data/backups/`): la cartella `data/` non è mai versionata e non viene mai toccata dagli aggiornamenti.

> **Nota di sicurezza** — l'app è pensata per uso locale o su rete privata. Se esposta a Internet, va protetta con un livello di autenticazione aggiuntivo (VPN o reverse proxy con access control).

## Aggiornamenti

L'app controlla all'avvio (e ogni 12 ore, o con "Controlla ora" in Impostazioni) il manifest dell'ultima [release](https://github.com/Astralon94/Zen-Human/releases) di questo repository, scarica il pacchetto, salva una copia dei file sovrascritti in `data/updates-backup/` e si riavvia sul nuovo codice. La variabile `ZEN_UPDATE_URL` permette di puntare a un altro manifest, oppure — se vuota — di disattivare gli aggiornamenti.

## Architettura

```
server.js          server node:http — statici da public/ + API /api
server/            schema, DB (node:sqlite, WAL), serializzazione/changeset, auth, updater
src/               frontend (Vite): state/, domain/, ui/ (viste)
public/index.html  SPA buildata, self-contained: è ciò che il server serve
scripts/           utilità: reset DB, reset admin, test round-trip, build pacchetto update
tests/             test (node --test)
data/              database + backup — locale, mai versionato
```

Principi: il documento JSON di ogni record è la **fonte di verità** (colonne SQL solo per query/indici); il frontend invia **changeset granulari** (`POST /api/changes`) con guardia di concorrenza; i valori derivati (netti, totali, stati) **non vengono mai salvati** — si salvano solo i fatti.

## Sviluppo

```bash
npm install          # dipendenze di build (Vite)
npm run dev          # frontend in sviluppo
npm run build        # build → public/index.html
node --test tests/*.test.mjs
npm run test:roundtrip
```

## Licenza

Rilasciato sotto licenza [MIT](LICENSE).

## Famiglia Zen

Zen Human fa parte di una piccola famiglia di app self-hosted con la stessa architettura: [Zen Finance](https://github.com/Astralon94/Zen-Finance) (contabilità e fatture) e [Zen Warehouse](https://github.com/Astralon94/Zen-Warehouse) (ordini fornitori e magazzino).
