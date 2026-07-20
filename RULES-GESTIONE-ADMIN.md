# Regole — Gestione & Amministrazione

Board gestite da questo ambiente:

| Board | ID | Liste principali |
|-------|-----|------------------|
| **Gestione** | `640a5c772f6cbeefe413aa88` | Cose Da Fare, In Esecuzione, Bloccati, Terminati |
| **Amministrazione** | `622a4c04b6f44e46f420f78f` | TODO, IN PROGRESS, Blocked, DONE |

**Assegnatario di riferimento:** Daniele Bocci (`danielebocci` / `TRELLO_DANIELE_ID`)

## WIP — limite task in corso

- **Massimo 3 task in "In Esecuzione" / "IN PROGRESS"** contemporaneamente
- Se ce ne sono di più, spostare i meno urgenti in backlog (Cose Da Fare / TODO)
- Task con etichetta `URGENTE` o `Emergenza Massima` possono superare il limite solo se esplicitamente richiesto

## Priorità

1. **URGENTE / Emergenza Massima** → entro 48 ore
2. **IN PROGRESS / In Esecuzione** con scadenza passata → entro la settimana corrente
3. **Pagamenti** (etichetta `Payments`) → slot dedicato (martedì/giovedì mattina)
4. **Chiamate / verifiche rapide** (< 30 min) → batch in un unico slot
5. **Progetti lunghi** (KPI, riorganizzazione, comodati) → 1 slot settimanale, scadenza realistica
6. **Blocked / Bloccati** → non schedulare; aggiungere commento con blocco e responsabile

## Scadenze

- Ogni task in **In Esecuzione / IN PROGRESS** deve avere una scadenza
- Task spostato in corso → impostare scadenza entro 5 giorni lavorativi
- Task completato → spostare in Terminati / DONE e segnare scadenza come completata
- Scadenze passate da > 7 giorni → commento di aggiornamento obbligatorio

## Liste da non toccare

- **Gestione:** Terminati, TEMPLATE, PERIODICI, Lavaggi Loretta, Dipartimento pulizie, BONIFICI…, LISTA COMPRARE…
- **Amministrazione:** DONE

## Comportamento AI

1. Leggere questo file + elencare task assegnati a Daniele
2. Escludere liste chiuse (Terminati, DONE, TEMPLATE, …)
3. Proporre schedulazione prima di modificare scadenze o liste
4. Chiedere conferma prima di spostare più di 5 card o archiviare
5. Commentare ogni spostamento non banale
6. Report finale in italiano: task schedulati, WIP attuale, blocchi, prossimi passi

## Esempi di comandi

- "Schedula i miei task su Gestione e Amministrazione per questa settimana"
- "Quali task urgenti ho aperti?"
- "Sposta in IN PROGRESS il pagamento IMANAGER con scadenza venerdì"
- "Riorganizza il backlog Amministrazione per priorità"

## Variabili `.env`

```env
TRELLO_GESTIONE_BOARD_ID=640a5c772f6cbeefe413aa88
TRELLO_AMMINISTRAZIONE_BOARD_ID=622a4c04b6f44e46f420f78f
TRELLO_DANIELE_ID=54dc67131a3fdbb01c491b00
```
