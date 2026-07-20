# Regole di gestione Trello

Modifica questo file con le tue regole. L'AI leggerà queste istruzioni quando usi il prompt `gestisci-trello` o la skill Trello.

## Board e liste

- Board principale: *(inserisci nome o lascia che l'AI usi TRELLO_DEFAULT_BOARD_ID)*
- **Backlog**: idee e task non ancora pianificati
- **In corso**: massimo 3 task attivi contemporaneamente
- **In review**: task completati in attesa di verifica
- **Fatto**: task completati e verificati

## Priorità e scadenze

- Task con scadenza entro 48 ore → spostare in cima alla lista "In corso"
- Task scaduti da più di 3 giorni → aggiungere commento e chiedere aggiornamento all'utente
- Nessuna scadenza su task in "In corso" → chiedere all'utente se impostarne una

## Etichette

- `urgente` (rosso): da trattare entro oggi
- `bug` (arancione): problemi da risolvere prima di nuove feature
- `feature` (verde): nuove funzionalità

## Comportamento AI

- **Leggere prima, agire dopo**: sempre analizzare lo stato prima di modificare
- **Spostamenti**: sposta le card solo se coerente con le regole sopra
- **Commenti**: lascia un commento breve quando sposti una card, spiegando il motivo
- **Conferma**: chiedi conferma prima di archiviare card o spostare più di 5 card in una sessione
- **Report**: al termine, riassumi cosa hai fatto e cosa resta da fare

## Esempi di comandi all'AI

- "Fammi un riepilogo dello stato della board"
- "Sposta in Fatto tutti i task completati in review da più di 2 giorni"
- "Crea un task per preparare la demo di venerdì nella lista Backlog"
- "Quali task scadono questa settimana?"
