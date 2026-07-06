# Zen-Human · Server MCP (sola lettura)

**Fase 2** dell'integrazione AI (stessa architettura di Zen-Finance): permette a un
assistente AI (Claude Desktop) di interrogare i dati HR di Zen-Human **in linguaggio
naturale**, in **sola lettura**.

## Caratteristiche
- **Zero dipendenze**: nessun `npm install`. Il protocollo MCP (JSON-RPC su stdio) è
  gestito a mano in `server.mjs`.
- **Sola lettura**: non scrive mai. Legge lo stato via `GET /api/data` del server locale
  di Zen-Human (quello su `http://localhost:4332`).
- **Verità dei dati**: riusa la **logica di dominio reale** dell'app (`src/domain/*`), quindi
  netto mensile, conteggi presenze/assenze, scadenze e residui prestiti coincidono
  ESATTAMENTE con quanto mostrano le viste Riepilogo, Scadenze e Voci economiche.

## Strumenti esposti
| Strumento | A cosa serve |
|---|---|
| `lista_aziende` | elenco aziende + numero dipendenti attivi (per sapere su cosa filtrare) |
| `lista_dipendenti` | dipendenti per azienda/stato, con mansione, contratto e netto pattuito del mese |
| `riepilogo` | KPI HR del mese: dipendenti, lavorati/assenze, netto totale, scadenze scadute/in scadenza |
| `scadenze` | contratti a termine e libretti sanitari ordinati per data (scaduti/imminenti in cima) |
| `dettaglio_dipendente` | scheda completa: contratto, scomposizione netto del mese, presenze, scadenze, prestiti |
| `voci_economiche` | bonus, sanzioni e acconti del mese, con totali per tipo |

## Prerequisito
Il server di Zen-Human deve essere **in esecuzione** (`avvia-zen.command`, oppure
`npm start` nella cartella Zen-Human, porta 4332): l'MCP legge da lì. Se è spento, gli
strumenti rispondono con un errore che lo segnala.

## Collegarlo a Claude Desktop (macOS)
Aggiungi questo blocco al file di configurazione:
`~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "zen-human": {
      "command": "node",
      "args": ["/Users/fmdesantis/Zen-Manager-Apps/Zen-Human/mcp/server.mjs"]
    }
  }
}
```

Se hai già altri `mcpServers` (es. `"zen-finance"`), aggiungi solo la voce `"zen-human"`
dentro l'oggetto esistente (non duplicare le graffe esterne). Poi **riavvia Claude
Desktop**. Variabile opzionale: `ZEN_HUMAN_URL` (default `http://localhost:4332`).

Esempi di domande: «quanti dipendenti attivi ho in totale?», «quali contratti scadono
nei prossimi 30 giorni?», «qual è il netto totale da liquidare questo mese?»,
«mostrami la scheda di Rossi», «i bonus di giugno».

## Prova rapida da terminale (debug)
```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"riepilogo","arguments":{}}}' \
 | (cat; sleep 3) | node mcp/server.mjs
```

## Limiti (voluti, per questa fase)
- Solo lettura: nessuna modifica ai dati.
- I dati escono verso l'AI cloud a cui è collegato Claude Desktop: gli strumenti
  restituiscono **slice/aggregati**, non l'intero database, ma tienilo presente.
- Solo Zen-Human. La stessa architettura è già attiva su Zen-Finance e si estende a Staff.
