# Manutenzioni

Documento di riferimento per la board **Manutenzioni** degli affittacamere.

| Board | ID | Override `.env` |
|-------|-----|-----------------|
| **Manutenzioni** | `618e372daa42cb68df7d7485` | `TRELLO_MANUTENZIONI_BOARD_ID` |

**Manutentore di riferimento:** Costache Ciurar (`TRELLO_MANUTENTORE_ID`)

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

## Cos’è un modulo

Un **modulo** è una camera, un corridoio, una cucina o un’area comune, identificato da una **sigla** nel titolo del task:

| Tipo | Esempi sigla |
|------|----------------|
| Camera | `NR1`, `NR2`, `DT101`, `ITC305` |
| Corridoio | `NR CORRIDOIO`, `DF CORRIDOIO` |
| Cucina | `NR CUCINA`, `DC CUCINA` |
| Area comune | `DT AREA COMUNE` |

Un modulo è **libero** quando Octorate lo indica come accessibile (ospiti assenti / area disponibile) per la data richiesta. Fonte: tool **octorate_camere** (`readCalendar`: LIBERA = availability>0 tutte le notti; OCCUPATA = 0 in almeno una notte). Non chiedere all’utente l’elenco dei moduli liberi — verificare sempre su Octorate. Solo i moduli liberi possono entrare in **IN ESECUZIONE**.

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

Anteprima: `npm run schedula -- NR1 NR2 --scadenza 16/07/2026 --dry-run`

Formati data: `16/07/2026`, `2026-07-16`, `domani`

## Priorità operative

1. **Emergenze / urgenze** → subito, anche fuori dalla schedulazione moduli
2. **IN ESECUZIONE** con scadenza oggi / scaduta → verificare e aggiornare
3. **Moduli liberi** → schedulare subito
4. **Periodici** su moduli che diventano liberi → promuovere in IN ESECUZIONE
5. **Settimana / Cose Da fare** → pianificare con slot e moduli accessibili

## Comportamento AI

1. Leggere questo file prima di agire sulla board Manutenzioni
2. Se servono i moduli liberi (per data o “domani”): chiamare **octorate_camere** e riportare le camere/aree LIBERE — non chiedere l’elenco all’utente
3. Ispezionare lo stato Trello prima di modificare
4. Schedulazione: tool **schedula_moduli** / `npm run schedula` oppure regola unica con tool Trello (sigle = moduli liberi da Octorate, o fornite esplicitamente dall’utente)
5. Non toccare **Template** e **Terminati**
6. Conferma prima di archiviare o spostare più di 5 card (salvo schedulazione esplicita)
7. Commentare ogni spostamento non banale
8. Report finale in italiano
