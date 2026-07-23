# Gestione Manutenzioni

Documento di riferimento per l’agente che gestisce la board **Manutenzioni** degli affittacamere.

| Board | ID | Override `.env` |
|-------|-----|-----------------|
| **Manutenzioni** | `618e372daa42cb68df7d7485` | `TRELLO_MANUTENZIONI_BOARD_ID` |

**Manutentore di riferimento:** Costache Ciurar (`TRELLO_MANUTENTORE_ID`)

---

## Liste

| Lista | Ruolo |
|-------|--------|
| **IN ESECUZIONE** | Lavori attivi sui moduli liberi (ospiti assenti / area disponibile) |
| **Settimana** | Task non periodici da fare quando il modulo non è libero |
| **Periodici** | Task ricorrenti in attesa che il modulo sia libero |
| **Cose Da fare** | Backlog manutenzioni |
| **Template** | Modelli — **mai toccare** |
| **Terminati** | Completati — **mai toccare** |
| Gestione, Magazzino, Spazio | Contesto / supporto — **non spostare card qui** |

**Liste gestite dalla schedulazione:** Periodici, IN ESECUZIONE, Cose Da fare, Settimana

---

## Cos’è un modulo

Un **modulo** è una camera, un corridoio, una cucina o un’area comune, identificato da una **sigla** nel titolo del task:

| Tipo | Esempi sigla |
|------|----------------|
| Camera | `NR1`, `NR2`, `DT101`, `ITC305` |
| Corridoio | `NR CORRIDOIO`, `DF CORRIDOIO` |
| Cucina | `NR CUCINA`, `DC CUCINA` |
| Area comune | `DT AREA COMUNE` |

Un modulo è **libero** quando l’utente lo indica esplicitamente (ospiti usciti, area accessibile). Solo allora i relativi task possono entrare in **IN ESECUZIONE**.

---

## Schedulazione moduli (regola unica)

Per ogni task sulle liste gestite:

| Modulo nella lista liberi? | Etichetta `Task Periodico`? | Lista destinazione |
|----------------------------|----------------------------|-------------------|
| Sì | qualsiasi | **IN ESECUZIONE** |
| No | Sì | **Periodici** |
| No | No | **Settimana** |

### Scadenze e assegnazioni

- Task che **entra** in IN ESECUZIONE → assegnato a Costache Ciurar + scadenza = data indicata dall’utente
- Task che **esce** da IN ESECUZIONE (→ Periodici o Settimana) → scadenza **rimossa**

### Comando rapido

In chat:

> **Schedula i compiti per i moduli liberi:** NR1, NR2, NR3, NR CORRIDOIO, NR CUCINA — **scadenza 16/07/2026**

O via script:

```bash
npm run schedula -- NR1 NR2 NR3 "NR CORRIDOIO" "NR CUCINA" --scadenza 16/07/2026
```

Anteprima senza modifiche:

```bash
npm run schedula -- NR1 NR2 --scadenza 16/07/2026 --dry-run
```

Formati data accettati: `16/07/2026`, `2026-07-16`, `domani`

---

## Priorità operative

1. **Emergenze / urgenze** (perdite, guasti bloccanti, sicurezza) → trattare subito, anche fuori dalla schedulazione moduli
2. **IN ESECUZIONE** con scadenza oggi / scaduta → verificare stato e aggiornare
3. **Moduli liberi** → schedulare subito i task relativi
4. **Periodici** su moduli che diventano liberi → promuovere in IN ESECUZIONE
5. **Settimana / Cose Da fare** → pianificare quando ci sono slot e moduli accessibili

---

## Comportamento AI

1. Leggere questo file prima di agire sulla board Manutenzioni
2. Ispezionare lo stato (liste, scadenze, moduli) prima di modificare
3. Per la schedulazione moduli: eseguire `npm run schedula` oppure applicare la regola unica con i tool Trello
4. Non toccare **Template** e **Terminati**
5. Chiedere conferma prima di archiviare o spostare più di 5 card (salvo schedulazione moduli esplicita)
6. Commentare ogni spostamento non banale
7. Report finale in italiano: task spostati (da→a), moduli liberi, saltati, scadenze, prossimi passi

---

## Esempi di comandi

- "Schedula i compiti per i moduli liberi: NR1, NR2, NR CUCINA — scadenza domani"
- "Quali task sono in IN ESECUZIONE e scadono oggi?"
- "Fammi un riepilogo della board Manutenzioni"
- "Sposta in Terminati i task completati di Costache"
- "Crea un task periodico per DF CORRIDOIO: controllo luci"

---

## Variabili `.env`

```env
TRELLO_MANUTENZIONI_BOARD_ID=618e372daa42cb68df7d7485
TRELLO_MANUTENTORE_ID=69bb36372d40c70721754e53
```
