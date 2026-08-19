# TrelloAI — istruzioni per gli agenti

Progetto MCP + bot Telegram **iManager** per Manutenzioni, Customer care, Pulizie e Interazione clienti.

## Regole operative

Fonte di verità: cartella [`rules/`](rules/README.md) (editabili anche dalla UI `/admin`).

| Area | File |
|------|------|
| Core | `rules/imanager.md` |
| Manutenzioni | `rules/manutenzioni.md` |
| Customer care | `rules/customer-care.md` |
| Pulizie / turni | `rules/pulizie.md` |
| Interazione clienti (+ AIBridge stub) | `rules/interazione-clienti.md` |

Config strutturata: [`config/`](config/) (`accommodations.json`, `turni.json`, `boards.json`).

## Uso tipico

- Riepilogo board / task: leggi le regole in `rules/` e usa i tool `trello_*`.
- Schedula moduli liberi: `rules/manutenzioni.md` e/o `npm run schedula -- <sigle> --scadenza <data>`.
- Config runtime: UI Admin (`ADMIN_TOKEN` in `.env`) su `/admin/`.

Skill di riferimento: `.cursor/skills/trello/SKILL.md`.

## Cursor Cloud specific instructions

1. All’avvio l’ambiente esegue `npm install` (vedi `.cursor/environment.json`).
2. Le credenziali Trello **non** sono nel repo: Secrets nel dashboard Cursor (`TRELLO_API_KEY`, `TRELLO_TOKEN`, …).
3. Il server MCP è in `.cursor/mcp.json` (`node src/server.js`).
4. Prima di modificare molte card o archiviare, chiedi conferma all’utente.
5. Rispondi sempre in italiano, salvo diversa richiesta.
