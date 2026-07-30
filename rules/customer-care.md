# Customer care

Area iManager per **Gestione** e **Amministrazione** (Trello) e supporto operativo interno. Non confondere con le chat ospiti (vedi `interazione-clienti.md`).

## Board

| Board | ID | Override `.env` |
|-------|-----|-----------------|
| **Gestione** | `640a5c772f6cbeefe413aa88` | `TRELLO_GESTIONE_BOARD_ID` |
| **Amministrazione** | `622a4c04b6f44e46f420f78f` | `TRELLO_AMMINISTRAZIONE_BOARD_ID` |

**Assegnatario di riferimento:** Daniele Bocci (`TRELLO_DANIELE_ID`)

Liste principali:

- Gestione: Cose Da Fare, In Esecuzione, Bloccati, Terminati
- Amministrazione: TODO, IN PROGRESS, Blocked, DONE

## WIP

- Massimo **3** task in "In Esecuzione" / "IN PROGRESS"
- Se ce ne sono di più, spostare i meno urgenti in backlog
- Etichetta `URGENTE` / `Emergenza Massima`: possono superare il limite solo se richiesto esplicitamente

## Priorità

1. URGENTE / Emergenza Massima → entro 48 ore
2. IN PROGRESS / In Esecuzione con scadenza passata → entro la settimana
3. Pagamenti (`Payments`) → slot martedì/giovedì mattina
4. Chiamate / verifiche rapide (< 30 min) → batch in uno slot
5. Progetti lunghi → 1 slot settimanale
6. Blocked / Bloccati → non schedulare; commento con blocco e responsabile

## Scadenze

- Ogni task in corso deve avere scadenza
- Entrata in corso → scadenza entro 5 giorni lavorativi
- Completato → Terminati / DONE
- Scadenze passate da > 7 giorni → commento obbligatorio

## Liste da non toccare

- **Gestione:** Terminati, TEMPLATE, PERIODICI, Lavaggi Loretta, Dipartimento pulizie, BONIFICI…, LISTA COMPRARE…
- **Amministrazione:** DONE

## Comportamento AI

1. Leggere questo file + task assegnati a Daniele
2. Escludere liste chiuse
3. Proporre schedulazione prima di modificare
4. Conferma prima di spostare > 5 card o archiviare
5. Commentare spostamenti non banali
6. Report in italiano

## Esempi

- "Schedula i miei task su Gestione e Amministrazione per questa settimana"
- "Quali task urgenti ho aperti?"
- "Sposta in IN PROGRESS il pagamento IMANAGER con scadenza venerdì"
