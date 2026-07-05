# Zen Human

App per il tracciamento di **presenze, assenze, voci economiche** e per la generazione del
**prospetto da inviare al consulente del lavoro**. Stessa famiglia di *Inconty*:
**offline-first, 100% locale**, niente cloud, niente backend. I dati restano sul dispositivo;
il backup è un file JSON.

## Cosa fa

**Base multi-azienda**
- Aziende con dati completamente separati (P.IVA, CF, note).
- Database di dipendenti diviso per azienda; selettore azienda nella topbar.

**Scheda dipendente**
- Anagrafica base (nome, cognome, mansione, colore, stato attivo/cessato).
- **Stipendio netto pattuito storicizzato per mese**: ogni mese può avere un valore diverso e lo storico resta consultabile.
- **Calendario presenze giornaliero**: si segna ogni giorno con uno stato (Presente, Ferie, Malattia, Infortunio, Permesso ROL, Permesso non retribuito, Riposo). Vuoto di default.
- Per ogni assenza/permesso si può inserire un **importo da scalare** dal netto (manuale, nessun calcolo proporzionale automatico).
- **Voci del mese**: bonus (+), sanzioni (−), acconti (−), con importo, data e descrizione.
- **Prestiti rateizzati**: piano rate generato in automatico (totale, n° rate, mese di partenza, importo rata) con residuo e barra di avanzamento; ogni rata si può segnare pagata o saltare.

**Riepilogo (prospetto per il consulente)**
- Tabella mensile per azienda: giorni lavorati, conteggio assenze per tipo, netto per dipendente, totali.
- Netto calcolato: `pattuito + bonus − sanzioni − acconti − rate prestiti − trattenute assenze`.
- Lo stato e i totali sono **sempre calcolati, mai salvati** (come lo stato fatture in Inconty).
- **Export PDF** (stampabile, con dettaglio voci) e **Export Excel/CSV**.

**Altro**: tema chiaro/scuro, installabile come PWA. La gestione delle **aziende** (crea/modifica/elimina) è dentro **Impostazioni**.
- **Cartella dati / vault (Chrome)**: unico meccanismo di salvataggio/backup. Collega una cartella su disco
  (anche iCloud/Dropbox) in cui l'app salva tutto automaticamente (`zen-human.json`, più `backups/` e
  `snapshots/` ripristinabili dalle Impostazioni). La copia nel browser resta come rete di sicurezza;
  al boot vince la copia con `rev` più alto.

## Architettura
Sorgenti modulari in `src/`, build in un **unico `index.html` self-contained** (tutto JS/CSS inlinato)
→ gira offline anche da file locale ed è installabile come PWA quando servito via HTTP.

```
src/
  state/     model.js (dati, stati presenza, migrazioni), store.js (persistenza + vault)
  domain/    util.js (denaro/date/mesi), payroll.js (stipendio, presenze, prestiti, netto)
  ui/        app.js (shell+router), dom.js, styles.css,
             views/ (riepilogo, dipendenti, aziende, impostazioni)
```

## Persistenza robusta
Fonte di verità in memoria; due copie durevoli: **localStorage + IndexedDB**. Ogni salvataggio
incrementa un contatore `rev` monotòno: al boot si adotta **sempre** la copia con `rev` più alto.

## Comandi
```bash
npm install      # dipendenze (solo build)
npm run dev      # sviluppo con hot-reload
npm run build    # genera dist/index.html (app da usare/distribuire)
npm run preview  # anteprima della build
```

## Uso
Apri **`dist/index.html`**. Per la PWA installabile servila via HTTP (`npm run preview`,
`python -m http.server`, il Raspberry Pi, ecc.). Su macOS/Chrome puoi installarla come app.
Backup e trasferimento dati avvengono tramite la **cartella dati** collegata (Impostazioni → Cartella dati).

> Pensata per uso esclusivo su **Mac + Chrome** (sfrutta la File System Access API per il vault su cartella).
