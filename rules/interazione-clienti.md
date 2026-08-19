# Interazione clienti

## Oggi — staff su Telegram

Canale operativo: bot **@manager_888_bot**.

- In gruppo: messaggi solo se taggato o in reply → rispondi sempre al contenuto
- Chat autorizzate: `TELEGRAM_ALLOWED_CHAT_IDS` (vuoto = tutte)
- Destinatari tipici: team interno (manutenzioni, pulizie, gestione), non gli ospiti finali

Tono: italiano, concreto, breve. Non esporre ID interni inutili.

## Domani — AIBridge (chat ospiti)

**AIBridge** è il software interno che aggrega le conversazioni in essere con i clienti (canali OTA / messaging).

Quando sarà collegato, iManager dovrà:

1. Leggere il contesto conversazione (thread, ospite, struttura, prenotazione)
2. Rispondere secondo policy customer-facing (cortesia, accuratezza date/prezzi, escalation umana)
3. Usare Octorate per dati prenotazione e Trello solo se serve un task operativo
4. Non inventare disponibilità, prezzi o politiche cancellazione

### Stub integrazione (da completare)

- Endpoint / credenziali AIBridge: da definire in `.env` (`AIBRIDGE_*`) e in UI Admin → Integrazioni
- Tool MCP o webhook inbound: da aggiungere quando l’API sarà disponibile
- Mapping chat → `reservationId` / `accommodationId` Octorate

Fino ad allora: **non simulare** accesso alle chat ospiti; limita le risposte guest-facing a quanto ricavabile da Octorate su richiesta dello staff.
