import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import {
  TrelloClient,
  formatBoardOverview,
  formatCard,
} from "./trello-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

config({ path: join(projectRoot, ".env") });

const defaultBoardId = process.env.TRELLO_DEFAULT_BOARD_ID || "";

function getClient() {
  return new TrelloClient(process.env.TRELLO_API_KEY, process.env.TRELLO_TOKEN);
}

function readRules() {
  const rulesPath = join(projectRoot, "RULES.md");
  if (!existsSync(rulesPath)) {
    return "Nessun file RULES.md trovato. Crea RULES.md nella root del progetto con le tue regole di gestione task.";
  }
  return readFileSync(rulesPath, "utf8");
}

function jsonResult(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

const server = new McpServer({
  name: "trello-ai",
  version: "1.0.0",
});

server.registerPrompt(
  "gestisci-trello",
  {
    description:
      "Prompt per far gestire all'AI la board Trello secondo le regole definite in RULES.md",
    argsSchema: {
      boardId: z
        .string()
        .optional()
        .describe("ID board Trello (usa TRELLO_DEFAULT_BOARD_ID se omesso)"),
      focus: z
        .string()
        .optional()
        .describe("Focus opzionale, es. 'task in scadenza questa settimana'"),
    },
  },
  async ({ boardId, focus }) => {
    const rules = readRules();
    const targetBoard = boardId || defaultBoardId;

    const focusLine = focus
      ? `\nFocus richiesto: ${focus}`
      : "";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Sei un assistente per la gestione di Trello. Usa i tool MCP trello_* per leggere e modificare la board.

## Regole di gestione (RULES.md)
${rules}

## Board di riferimento
${targetBoard ? `Board ID: ${targetBoard}` : "Nessuna board predefinita. Chiedi all'utente quale board usare oppure usa trello_list_boards."}
${focusLine}

## Workflow
1. Leggi lo stato attuale con trello_get_board_overview (o trello_list_cards).
2. Riassumi cosa accade: task per lista, scadenze, attività recente.
3. Applica le regole in RULES.md: sposta card, aggiorna scadenze, aggiungi commenti, crea task mancanti.
4. Prima di modifiche distruttive (archiviazione, spostamenti massivi), chiedi conferma all'utente.
5. Dopo ogni modifica, riporta cosa hai fatto e perché (in base alle regole).

Inizia analizzando lo stato della board.`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "stato-trello",
  {
    description: "Ottieni un riepilogo dello stato attuale della board Trello",
    argsSchema: {
      boardId: z.string().optional().describe("ID board Trello"),
    },
  },
  async ({ boardId }) => {
    const targetBoard = boardId || defaultBoardId;
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Analizza lo stato della board Trello ${targetBoard || "(usa trello_list_boards per scegliere)"}.

Usa i tool trello_get_board_overview e trello_get_board_activity per:
- elencare tutte le liste e le card
- evidenziare scadenze imminenti e task bloccati
- riassumere l'attività recente
- segnalare anomalie rispetto a RULES.md (leggi il file nel progetto)

Rispondi in italiano con un report chiaro e actionable.`,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  "schedula-moduli",
  {
    description:
      "Schedula i compiti manutenzione spostando task per moduli liberi (camere, corridoi, cucine)",
    argsSchema: {
      moduliLiberi: z
        .string()
        .describe(
          "Sigle moduli liberi, separate da virgola. Es: NR1, NR2, NR3, NR CORRIDOIO, NR CUCINA"
        ),
      dataScadenza: z
        .string()
        .describe(
          "Data di scadenza per i task in IN ESECUZIONE. Es: 16/07/2026, 2026-07-16, domani"
        ),
    },
  },
  async ({ moduliLiberi, dataScadenza }) => {
    const schedulaPath = join(projectRoot, "GESTIONE-MANUTENZIONI.md");
    const schedulaRules = existsSync(schedulaPath)
      ? readFileSync(schedulaPath, "utf8")
      : "";

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Schedula i compiti per i moduli liberi sulla board Manutenzioni.

## Moduli liberi (da schedulare)
${moduliLiberi}

## Scadenza
${dataScadenza}

## Regole
${schedulaRules}

## Istruzioni
1. Esegui: \`npm run schedula -- ${moduliLiberi.split(/[,;\n]+/).map((m) => m.trim()).filter(Boolean).join(" ")} --scadenza ${dataScadenza}\`
   Oppure applica manualmente la regola unica con i tool trello_*.
2. Non toccare liste Template e Terminati.
3. Task in IN ESECUZIONE: assegna Costache Ciurar e scadenza ${dataScadenza}.
   Task che escono da IN ESECUZIONE: rimuovi la scadenza.
4. Riporta in italiano: task spostati (da→a), moduli liberi, task saltati.

Procedi.`,
          },
        },
      ],
    };
  }
);

server.registerResource(
  "regole-gestione",
  "trello://rules",
  {
    description: "Regole personalizzate per la gestione dei task Trello",
    mimeType: "text/markdown",
  },
  async () => ({
    contents: [
      {
        uri: "trello://rules",
        mimeType: "text/markdown",
        text: readRules(),
      },
    ],
  })
);

server.registerTool(
  "trello_list_boards",
  {
    description: "Elenca tutte le board Trello aperte dell'utente",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    const client = getClient();
    const boards = await client.listBoards();
    return jsonResult(
      boards.map((b) => ({
        id: b.id,
        name: b.name,
        url: b.url,
        lastActivity: b.dateLastActivity,
      }))
    );
  }
);

server.registerTool(
  "trello_get_board_overview",
  {
    description:
      "Panoramica completa di una board: liste, card, scadenze e link",
    inputSchema: {
      boardId: z
        .string()
        .optional()
        .describe("ID board (default: TRELLO_DEFAULT_BOARD_ID)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ boardId }) => {
    const id = boardId || defaultBoardId;
    if (!id) throw new Error("Specifica boardId o imposta TRELLO_DEFAULT_BOARD_ID");
    const client = getClient();
    const board = await client.getBoard(id);
    return jsonResult(formatBoardOverview(board));
  }
);

server.registerTool(
  "trello_list_lists",
  {
    description: "Elenca le liste di una board Trello",
    inputSchema: {
      boardId: z.string().describe("ID della board"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ boardId }) => {
    const client = getClient();
    const lists = await client.listLists(boardId);
    return jsonResult(lists);
  }
);

server.registerTool(
  "trello_list_cards",
  {
    description: "Elenca le card di una board o di una lista",
    inputSchema: {
      boardId: z.string().optional().describe("ID board"),
      listId: z.string().optional().describe("ID lista (alternativa a boardId)"),
      filter: z
        .enum(["open", "closed", "all"])
        .optional()
        .describe("Filtro card (default: open)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ boardId, listId, filter = "open" }) => {
    const client = getClient();
    const cards = await client.listCards({ boardId, listId, filter });
    let listNameById = {};
    if (boardId) {
      const lists = await client.listLists(boardId);
      listNameById = Object.fromEntries(lists.map((l) => [l.id, l.name]));
    }
    return jsonResult(cards.map((c) => formatCard(c, listNameById)));
  }
);

server.registerTool(
  "trello_get_card",
  {
    description:
      "Dettaglio completo di una card: descrizione, commenti, checklist, membri",
    inputSchema: {
      cardId: z.string().describe("ID della card"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ cardId }) => {
    const client = getClient();
    const card = await client.getCard(cardId);
    return jsonResult(card);
  }
);

server.registerTool(
  "trello_create_card",
  {
    description: "Crea una nuova card in una lista",
    inputSchema: {
      idList: z.string().describe("ID della lista di destinazione"),
      name: z.string().describe("Titolo della card"),
      desc: z.string().optional().describe("Descrizione"),
      due: z.string().optional().describe("Scadenza ISO 8601, es. 2026-07-20T17:00:00.000Z"),
      idLabels: z.array(z.string()).optional().describe("ID etichette"),
    },
  },
  async ({ idList, name, desc, due, idLabels }) => {
    const client = getClient();
    const card = await client.createCard({ idList, name, desc, due, idLabels });
    return jsonResult(formatCard(card));
  }
);

server.registerTool(
  "trello_update_card",
  {
    description: "Aggiorna una card esistente (nome, descrizione, scadenza, lista)",
    inputSchema: {
      cardId: z.string().describe("ID della card"),
      name: z.string().optional(),
      desc: z.string().optional(),
      due: z.string().optional().describe("Scadenza ISO 8601 o null per rimuoverla"),
      dueComplete: z.boolean().optional(),
      idList: z.string().optional().describe("Sposta in un'altra lista"),
      closed: z.boolean().optional(),
    },
  },
  async ({ cardId, ...fields }) => {
    const client = getClient();
    const card = await client.updateCard(cardId, fields);
    return jsonResult(formatCard(card));
  }
);

server.registerTool(
  "trello_move_card",
  {
    description: "Sposta una card in un'altra lista",
    inputSchema: {
      cardId: z.string().describe("ID della card"),
      idList: z.string().describe("ID lista di destinazione"),
    },
  },
  async ({ cardId, idList }) => {
    const client = getClient();
    const card = await client.moveCard(cardId, idList);
    return jsonResult(formatCard(card));
  }
);

server.registerTool(
  "trello_add_comment",
  {
    description: "Aggiunge un commento a una card",
    inputSchema: {
      cardId: z.string().describe("ID della card"),
      text: z.string().describe("Testo del commento"),
    },
  },
  async ({ cardId, text }) => {
    const client = getClient();
    const action = await client.addComment(cardId, text);
    return jsonResult({ id: action.id, text: action.data?.text, date: action.date });
  }
);

server.registerTool(
  "trello_archive_card",
  {
    description: "Archivia (chiude) una card",
    inputSchema: {
      cardId: z.string().describe("ID della card"),
    },
  },
  async ({ cardId }) => {
    const client = getClient();
    const card = await client.archiveCard(cardId);
    return jsonResult({ id: card.id, name: card.name, archived: true });
  }
);

server.registerTool(
  "trello_search",
  {
    description: "Cerca card per testo all'interno di una board",
    inputSchema: {
      boardId: z.string().describe("ID board"),
      query: z.string().describe("Testo da cercare"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ boardId, query }) => {
    const client = getClient();
    const result = await client.searchBoard(boardId, query);
    const cards = result.cards || [];
    const lists = await client.listLists(boardId);
    const listNameById = Object.fromEntries(lists.map((l) => [l.id, l.name]));
    return jsonResult(cards.map((c) => formatCard(c, listNameById)));
  }
);

server.registerTool(
  "trello_get_board_activity",
  {
    description: "Attività recente su una board (creazioni, spostamenti, commenti)",
    inputSchema: {
      boardId: z.string().describe("ID board"),
      limit: z.number().optional().describe("Numero azioni (default 20)"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ boardId, limit = 20 }) => {
    const client = getClient();
    const actions = await client.getBoardActions(boardId, limit);
    return jsonResult(
      actions.map((a) => ({
        type: a.type,
        date: a.date,
        member: a.memberCreator?.fullName,
        data: a.data,
      }))
    );
  }
);

server.registerTool(
  "trello_get_labels",
  {
    description: "Elenca le etichette disponibili su una board",
    inputSchema: {
      boardId: z.string().describe("ID board"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ boardId }) => {
    const client = getClient();
    const labels = await client.getLabels(boardId);
    return jsonResult(labels);
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Errore server MCP Trello:", error);
  process.exit(1);
});
