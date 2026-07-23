# TrelloAI — istruzioni per gli agenti

Progetto MCP + skill per gestire board Trello secondo regole in `RULES.md`, `GESTIONE-MANUTENZIONI.md` e `RULES-GESTIONE-ADMIN.md`.

## Uso tipico

- Riepilogo board / task: leggi le regole e usa i tool `trello_*` (o i prompt MCP `stato-trello`, `gestisci-trello`).
- Schedula moduli liberi: segui `GESTIONE-MANUTENZIONI.md` e/o `npm run schedula -- <sigle> --scadenza <data>`.
- Schedula Gestione & Amministrazione: segui `RULES-GESTIONE-ADMIN.md` e il prompt `schedula-gestione` se disponibile.

Skill di riferimento: `.cursor/skills/trello/SKILL.md`.

## Cursor Cloud specific instructions

Questo repo è pensato per Cloud Agents (app iOS / [cursor.com/agents](https://cursor.com/agents)).

1. All’avvio l’ambiente esegue `npm install` (vedi `.cursor/environment.json`).
2. Le credenziali Trello **non** sono nel repo: devono essere Secrets nel dashboard Cursor (`TRELLO_API_KEY`, `TRELLO_TOKEN`, e gli eventuali ID board/membri da `.env.example`).
3. Il server MCP è in `.cursor/mcp.json` (`node src/server.js`). In cloud deve partire con le variabili d’ambiente già presenti; in locale `src/server.js` carica anche `.env`.
4. Prima di modificare molte card o archiviare, chiedi conferma all’utente (anche da mobile).
5. Rispondi sempre in italiano, salvo diversa richiesta.
