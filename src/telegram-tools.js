import { TrelloClient, formatCard, formatBoardOverview } from "./trello-client.js";
import { schedulaModuli } from "./schedula-moduli.js";
import { resolveBoardIds, resolvePeople } from "./runtime-config.js";

/** Board IDs: env > config/boards.json (Proxy = sempre aggiornato dopo save UI). */
export const BOARD_IDS = new Proxy(
  {},
  {
    get(_t, prop) {
      if (typeof prop !== "string") return undefined;
      return resolveBoardIds()[prop];
    },
    ownKeys() {
      return Object.keys(resolveBoardIds());
    },
    getOwnPropertyDescriptor(_t, prop) {
      const v = resolveBoardIds()[prop];
      if (v == null) return undefined;
      return { configurable: true, enumerable: true, value: v };
    },
  }
);

function knownMembers() {
  const people = resolvePeople();
  return [
    {
      names: ["costache", "ciurar", "manutentore"],
      id: people.manutentore?.id,
    },
    {
      names: ["daniele", "bocci", "danielebocci"],
      id: people.daniele?.id,
    },
    {
      names: ["meri", "lisna", "merilisna"],
      id: people.meri?.id,
    },
  ].filter((m) => m.id);
}

function client() {
  return new TrelloClient(process.env.TRELLO_API_KEY, process.env.TRELLO_TOKEN);
}

async function resolveBoardId(board) {
  if (!board) return BOARD_IDS.manutenzioni;
  const key = String(board).trim().toLowerCase();
  if (BOARD_IDS[key]) return BOARD_IDS[key];
  if (/^[a-f0-9]{24}$/i.test(board)) return board;
  if (key.includes("manutenz")) return BOARD_IDS.manutenzioni;
  if (key.includes("gestione")) return BOARD_IDS.gestione;
  if (key.includes("amministr")) return BOARD_IDS.amministrazione;

  const boards = await client().listBoards("all");
  const exact = boards.find((b) => b.name.toLowerCase() === key);
  if (exact) return exact.id;
  const partial = boards.find((b) => b.name.toLowerCase().includes(key));
  if (partial) return partial.id;

  throw new Error(
    `Board sconosciuta: ${board}. Usa list_boards oppure ID / nome esatto.`
  );
}

function findList(lists, listName) {
  if (!listName) return null;
  const target = listName.trim().toLowerCase();
  const exact = lists.find((l) => l.name.toLowerCase() === target);
  if (exact) return exact;
  const aliases = {
    "da fare": ["cose da fare", "da fare", "todo"],
    "in esecuzione": ["in esecuzione", "in progress"],
    terminati: ["terminati", "done"],
  };
  for (const [canon, names] of Object.entries(aliases)) {
    if (target === canon || names.includes(target)) {
      return lists.find(
        (l) => names.includes(l.name.toLowerCase()) || l.name.toLowerCase() === canon
      );
    }
  }
  return lists.find((l) => l.name.toLowerCase().includes(target));
}

function parseDue(input) {
  if (!input) return undefined;
  const value = String(input).trim().toLowerCase();
  if (value === "domani" || value === "tomorrow") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setUTCHours(6, 0, 0, 0);
    return d.toISOString();
  }
  if (value === "oggi" || value === "today") {
    const d = new Date();
    d.setUTCHours(6, 0, 0, 0);
    return d.toISOString();
  }
  const it = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (it) {
    const d = new Date(Date.UTC(+it[3], +it[2] - 1, +it[1], 6, 0, 0));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3], 6, 0, 0));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const parsed = new Date(input);
  if (!Number.isNaN(parsed.getTime())) {
    parsed.setUTCHours(6, 0, 0, 0);
    return parsed.toISOString();
  }
  throw new Error(`Data non valida: ${input}`);
}

async function resolveMemberIds(boardId, names) {
  if (!names?.length) return [];
  const trello = client();
  const members = await trello.getBoardMembers(boardId);
  const ids = [];

  for (const raw of names) {
    const q = String(raw).trim().toLowerCase();
    const known = knownMembers().find((m) =>
      m.names.some((n) => q.includes(n) || n.includes(q))
    );
    if (known?.id) {
      ids.push(known.id);
      continue;
    }
    const found = members.find(
      (m) =>
        m.fullName?.toLowerCase().includes(q) ||
        m.username?.toLowerCase().includes(q)
    );
    if (!found) throw new Error(`Membro non trovato: ${raw}`);
    ids.push(found.id);
  }
  return [...new Set(ids)];
}

function tool(name, description, properties, required = []) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

const boardProp = {
  type: "string",
  description:
    "Alias (manutenzioni|gestione|amministrazione), nome board, oppure ID 24 hex",
};

export const TOOL_DEFINITIONS = [
  tool("list_boards", "Elenca tutte le board accessibili con il token Trello", {
    includeClosed: { type: "boolean" },
  }),
  tool("get_me", "Account Trello collegato (chi sta agendo)"),
  tool("list_lists", "Liste di una board", { board: boardProp }, ["board"]),
  tool("list_members", "Membri di una board", { board: boardProp }, ["board"]),
  tool(
    "list_labels",
    "Etichette di una board",
    { board: boardProp },
    ["board"]
  ),
  tool(
    "board_overview",
    "Panoramica liste+card di una board",
    {
      board: boardProp,
      listFilter: { type: "string" },
      limitPerList: { type: "number" },
    },
    ["board"]
  ),
  tool(
    "board_activity",
    "Attività recente di una board",
    { board: boardProp, limit: { type: "number" } },
    ["board"]
  ),
  tool(
    "search_cards",
    "Cerca card (una board o tutte)",
    {
      query: { type: "string" },
      board: boardProp,
    },
    ["query"]
  ),
  tool("get_card", "Dettaglio card (commenti, checklist, allegati, membri)", {
    cardId: { type: "string" },
  }, ["cardId"]),
  tool(
    "create_card",
    "Crea card",
    {
      board: boardProp,
      list: { type: "string" },
      name: { type: "string" },
      desc: { type: "string" },
      due: { type: "string" },
      assignTo: { type: "array", items: { type: "string" } },
      labels: { type: "array", items: { type: "string" }, description: "Nomi o ID etichette" },
      pos: { type: "string" },
    },
    ["board", "list", "name"]
  ),
  tool(
    "copy_card",
    "Copia una card in una lista",
    {
      board: boardProp,
      list: { type: "string" },
      sourceCardId: { type: "string" },
      name: { type: "string" },
    },
    ["board", "list", "sourceCardId"]
  ),
  tool(
    "move_card",
    "Sposta card in altra lista",
    { cardId: { type: "string" }, board: boardProp, list: { type: "string" } },
    ["cardId", "board", "list"]
  ),
  tool(
    "update_card",
    "Aggiorna card (nome, desc, due, assegnatari, dueComplete)",
    {
      cardId: { type: "string" },
      board: boardProp,
      name: { type: "string" },
      desc: { type: "string" },
      due: { type: "string" },
      clearDue: { type: "boolean" },
      dueComplete: { type: "boolean" },
      assignTo: { type: "array", items: { type: "string" } },
      pos: { type: "string" },
    },
    ["cardId"]
  ),
  tool("archive_card", "Archivia card", { cardId: { type: "string" } }, ["cardId"]),
  tool("unarchive_card", "Ripristina card archiviata", { cardId: { type: "string" } }, [
    "cardId",
  ]),
  tool("delete_card", "Elimina definitivamente una card", { cardId: { type: "string" } }, [
    "cardId",
  ]),
  tool(
    "add_comment",
    "Commento su card",
    { cardId: { type: "string" }, text: { type: "string" } },
    ["cardId", "text"]
  ),
  tool(
    "update_comment",
    "Modifica un commento (action id)",
    { actionId: { type: "string" }, text: { type: "string" } },
    ["actionId", "text"]
  ),
  tool("delete_comment", "Elimina commento", { actionId: { type: "string" } }, [
    "actionId",
  ]),
  tool(
    "assign_members",
    "Assegna membri a una card (sostituisce o aggiunge)",
    {
      cardId: { type: "string" },
      board: boardProp,
      members: { type: "array", items: { type: "string" } },
      mode: { type: "string", description: "replace | add (default add)" },
    },
    ["cardId", "board", "members"]
  ),
  tool(
    "remove_member",
    "Rimuove un membro da una card",
    {
      cardId: { type: "string" },
      board: boardProp,
      member: { type: "string" },
    },
    ["cardId", "board", "member"]
  ),
  tool(
    "add_label",
    "Aggiunge etichetta a card (per nome o id)",
    {
      cardId: { type: "string" },
      board: boardProp,
      label: { type: "string" },
    },
    ["cardId", "board", "label"]
  ),
  tool(
    "remove_label",
    "Rimuove etichetta da card",
    {
      cardId: { type: "string" },
      board: boardProp,
      label: { type: "string" },
    },
    ["cardId", "board", "label"]
  ),
  tool(
    "create_label",
    "Crea etichetta su board",
    {
      board: boardProp,
      name: { type: "string" },
      color: {
        type: "string",
        description: "yellow|purple|blue|red|green|orange|black|sky|pink|lime|null",
      },
    },
    ["board", "name"]
  ),
  tool(
    "create_list",
    "Crea lista su board",
    { board: boardProp, name: { type: "string" }, pos: { type: "string" } },
    ["board", "name"]
  ),
  tool(
    "update_list",
    "Rinomina/sposta/archivia lista",
    {
      listId: { type: "string" },
      name: { type: "string" },
      pos: { type: "string" },
      closed: { type: "boolean" },
    },
    ["listId"]
  ),
  tool(
    "create_checklist",
    "Crea checklist su card",
    { cardId: { type: "string" }, name: { type: "string" } },
    ["cardId", "name"]
  ),
  tool(
    "add_checklist_item",
    "Aggiunge voce a checklist",
    {
      checklistId: { type: "string" },
      name: { type: "string" },
      checked: { type: "boolean" },
    },
    ["checklistId", "name"]
  ),
  tool(
    "set_checklist_item",
    "Segna voce checklist complete/incomplete",
    {
      cardId: { type: "string" },
      checkItemId: { type: "string" },
      state: { type: "string", description: "complete | incomplete" },
      name: { type: "string" },
    },
    ["cardId", "checkItemId", "state"]
  ),
  tool(
    "delete_checklist_item",
    "Elimina voce checklist",
    { checklistId: { type: "string" }, checkItemId: { type: "string" } },
    ["checklistId", "checkItemId"]
  ),
  tool("delete_checklist", "Elimina checklist", { checklistId: { type: "string" } }, [
    "checklistId",
  ]),
  tool(
    "add_attachment",
    "Allega URL a una card",
    { cardId: { type: "string" }, url: { type: "string" }, name: { type: "string" } },
    ["cardId", "url"]
  ),
  tool(
    "delete_attachment",
    "Rimuove allegato",
    { cardId: { type: "string" }, attachmentId: { type: "string" } },
    ["cardId", "attachmentId"]
  ),
  tool(
    "create_board",
    "Crea una nuova board",
    {
      name: { type: "string" },
      desc: { type: "string" },
      defaultLists: { type: "boolean" },
    },
    ["name"]
  ),
  tool(
    "update_board",
    "Aggiorna board (nome, desc, closed, …)",
    {
      board: boardProp,
      name: { type: "string" },
      desc: { type: "string" },
      closed: { type: "boolean" },
    },
    ["board"]
  ),
  tool(
    "schedula_moduli",
    "Schedula moduli liberi sulla board Manutenzioni",
    {
      modules: { type: "array", items: { type: "string" } },
      due: { type: "string" },
      dryRun: { type: "boolean" },
    },
    ["modules", "due"]
  ),
  tool(
    "trello_api",
    "Chiamata grezza a QUALSIASI endpoint REST Trello. path es. /cards/{id}/stickers. paramsJson = oggetto JSON serializzato dei query params (key/token automatici).",
    {
      method: {
        type: "string",
        description: "GET | POST | PUT | DELETE",
      },
      path: {
        type: "string",
        description: "Path API tipo /boards/{id}/cards o /cards/{id}",
      },
      paramsJson: {
        type: "string",
        description: 'Es. {"name":"Nuovo","idList":"..."} oppure {}',
      },
    },
    ["method", "path"]
  ),
];

async function resolveLabelId(boardId, labelRef) {
  const labels = await client().getLabels(boardId);
  const q = String(labelRef).trim().toLowerCase();
  if (/^[a-f0-9]{24}$/i.test(labelRef)) return labelRef;
  const found = labels.find(
    (l) => l.name?.toLowerCase() === q || l.name?.toLowerCase().includes(q)
  );
  if (!found) throw new Error(`Etichetta non trovata: ${labelRef}`);
  return found.id;
}

export async function executeTool(name, args = {}) {
  const trello = client();

  switch (name) {
    case "list_boards": {
      const boards = await trello.listBoards(args.includeClosed ? "all" : "open");
      return boards.map((b) => ({
        id: b.id,
        name: b.name,
        url: b.url || b.shortUrl,
        closed: b.closed,
      }));
    }
    case "get_me":
      return trello.getMe();
    case "list_lists": {
      const boardId = await resolveBoardId(args.board);
      const lists = await trello.listLists(boardId);
      return { boardId, lists: lists.map((l) => ({ id: l.id, name: l.name, closed: l.closed })) };
    }
    case "list_members": {
      const boardId = await resolveBoardId(args.board);
      return (await trello.getBoardMembers(boardId)).map((m) => ({
        id: m.id,
        fullName: m.fullName,
        username: m.username,
      }));
    }
    case "list_labels": {
      const boardId = await resolveBoardId(args.board);
      return trello.getLabels(boardId);
    }
    case "board_overview": {
      const boardId = await resolveBoardId(args.board);
      const board = await trello.getBoard(boardId);
      const overview = formatBoardOverview(board);
      const limit = Math.min(args.limitPerList || 15, 40);
      let lists = overview.lists;
      if (args.listFilter) {
        const f = args.listFilter.toLowerCase();
        lists = lists.filter((l) => l.name.toLowerCase().includes(f));
      }
      return {
        id: overview.id,
        name: overview.name,
        url: overview.url,
        lists: lists.map((l) => ({
          id: l.id,
          name: l.name,
          count: l.cards.length,
          cards: l.cards.slice(0, limit).map((c) => ({
            id: c.id,
            name: c.name,
            due: c.due,
            url: c.url,
            labels: c.labels,
          })),
        })),
      };
    }
    case "board_activity": {
      const boardId = await resolveBoardId(args.board);
      const actions = await trello.getBoardActions(boardId, args.limit || 20);
      return actions.map((a) => ({
        type: a.type,
        date: a.date,
        member: a.memberCreator?.fullName,
        data: a.data,
      }));
    }
    case "search_cards": {
      let result;
      if (args.board) {
        const boardId = await resolveBoardId(args.board);
        result = await trello.searchBoard(boardId, args.query);
      } else {
        result = await trello.search({ query: args.query });
      }
      return (result.cards || []).slice(0, 25).map((c) => ({
        id: c.id,
        name: c.name,
        url: c.shortUrl || c.url,
        idBoard: c.idBoard,
        idList: c.idList,
        due: c.due,
      }));
    }
    case "get_card": {
      const card = await trello.getCard(args.cardId);
      return {
        id: card.id,
        idBoard: card.idBoard,
        name: card.name,
        desc: card.desc,
        due: card.due,
        dueComplete: card.dueComplete,
        url: card.shortUrl || card.url,
        closed: card.closed,
        members: (card.members || []).map((m) => ({
          id: m.id,
          name: m.fullName || m.username,
        })),
        labels: (card.labels || []).map((l) => ({ id: l.id, name: l.name, color: l.color })),
        checklists: (card.checklists || []).map((cl) => ({
          id: cl.id,
          name: cl.name,
          items: (cl.checkItems || []).map((i) => ({
            id: i.id,
            name: i.name,
            state: i.state,
          })),
        })),
        attachments: (card.attachments || []).map((a) => ({
          id: a.id,
          name: a.name,
          url: a.url,
        })),
        comments: (card.actions || [])
          .filter((a) => a.type === "commentCard")
          .slice(0, 15)
          .map((a) => ({
            id: a.id,
            text: a.data?.text,
            by: a.memberCreator?.fullName,
            date: a.date,
          })),
      };
    }
    case "create_card": {
      const boardId = await resolveBoardId(args.board);
      const lists = await trello.listLists(boardId);
      const list = findList(lists, args.list);
      if (!list) {
        throw new Error(
          `Lista "${args.list}" non trovata. Disponibili: ${lists.map((l) => l.name).join(", ")}`
        );
      }
      const idMembers = await resolveMemberIds(boardId, args.assignTo);
      let idLabels;
      if (args.labels?.length) {
        idLabels = [];
        for (const lab of args.labels) {
          idLabels.push(await resolveLabelId(boardId, lab));
        }
      }
      const card = await trello.createCard({
        idList: list.id,
        name: args.name,
        desc: args.desc,
        due: parseDue(args.due),
        idMembers,
        idLabels,
        pos: args.pos,
      });
      return {
        ok: true,
        id: card.id,
        name: card.name,
        list: list.name,
        url: card.shortUrl || card.url,
        due: card.due,
      };
    }
    case "copy_card": {
      const boardId = await resolveBoardId(args.board);
      const lists = await trello.listLists(boardId);
      const list = findList(lists, args.list);
      if (!list) throw new Error(`Lista "${args.list}" non trovata`);
      const card = await trello.copyCard({
        idList: list.id,
        idCardSource: args.sourceCardId,
        name: args.name,
      });
      return { ok: true, id: card.id, name: card.name, url: card.shortUrl || card.url };
    }
    case "move_card": {
      const boardId = await resolveBoardId(args.board);
      const lists = await trello.listLists(boardId);
      const list = findList(lists, args.list);
      if (!list) throw new Error(`Lista "${args.list}" non trovata`);
      await trello.moveCard(args.cardId, list.id);
      return { ok: true, cardId: args.cardId, list: list.name };
    }
    case "update_card": {
      const fields = {};
      if (args.name !== undefined) fields.name = args.name;
      if (args.desc !== undefined) fields.desc = args.desc;
      if (args.dueComplete !== undefined) fields.dueComplete = args.dueComplete;
      if (args.pos !== undefined) fields.pos = args.pos;
      if (args.clearDue) fields.due = null;
      else if (args.due !== undefined) fields.due = parseDue(args.due);
      if (args.assignTo?.length) {
        const boardId = await resolveBoardId(args.board || "gestione");
        fields.idMembers = await resolveMemberIds(boardId, args.assignTo);
      }
      const card = await trello.updateCard(args.cardId, fields);
      return {
        ok: true,
        id: card.id,
        name: card.name,
        due: card.due,
        url: card.shortUrl || card.url,
      };
    }
    case "archive_card":
      await trello.archiveCard(args.cardId);
      return { ok: true, cardId: args.cardId, closed: true };
    case "unarchive_card":
      await trello.unarchiveCard(args.cardId);
      return { ok: true, cardId: args.cardId, closed: false };
    case "delete_card":
      await trello.deleteCard(args.cardId);
      return { ok: true, deleted: args.cardId };
    case "add_comment":
      return {
        ok: true,
        ...(await trello.addComment(args.cardId, args.text)),
      };
    case "update_comment":
      await trello.updateComment(args.actionId, args.text);
      return { ok: true, actionId: args.actionId };
    case "delete_comment":
      await trello.deleteComment(args.actionId);
      return { ok: true, deleted: args.actionId };
    case "assign_members": {
      const boardId = await resolveBoardId(args.board);
      const ids = await resolveMemberIds(boardId, args.members);
      if ((args.mode || "add") === "replace") {
        await trello.updateCard(args.cardId, { idMembers: ids });
      } else {
        for (const id of ids) await trello.addMemberToCard(args.cardId, id);
      }
      return { ok: true, members: args.members, ids };
    }
    case "remove_member": {
      const boardId = await resolveBoardId(args.board);
      const [id] = await resolveMemberIds(boardId, [args.member]);
      await trello.removeMemberFromCard(args.cardId, id);
      return { ok: true, removed: args.member };
    }
    case "add_label": {
      const boardId = await resolveBoardId(args.board);
      const labelId = await resolveLabelId(boardId, args.label);
      await trello.addLabelToCard(args.cardId, labelId);
      return { ok: true, labelId };
    }
    case "remove_label": {
      const boardId = await resolveBoardId(args.board);
      const labelId = await resolveLabelId(boardId, args.label);
      await trello.removeLabelFromCard(args.cardId, labelId);
      return { ok: true, labelId };
    }
    case "create_label": {
      const boardId = await resolveBoardId(args.board);
      return trello.createLabel({
        idBoard: boardId,
        name: args.name,
        color: args.color,
      });
    }
    case "create_list": {
      const boardId = await resolveBoardId(args.board);
      return trello.createList({
        idBoard: boardId,
        name: args.name,
        pos: args.pos || "bottom",
      });
    }
    case "update_list": {
      const fields = {};
      if (args.name !== undefined) fields.name = args.name;
      if (args.pos !== undefined) fields.pos = args.pos;
      if (args.closed !== undefined) fields.closed = args.closed;
      return trello.updateList(args.listId, fields);
    }
    case "create_checklist":
      return trello.createChecklist({ idCard: args.cardId, name: args.name });
    case "add_checklist_item":
      return trello.addCheckItem({
        checklistId: args.checklistId,
        name: args.name,
        checked: Boolean(args.checked),
      });
    case "set_checklist_item":
      return trello.updateCheckItem({
        cardId: args.cardId,
        checkItemId: args.checkItemId,
        state: args.state,
        name: args.name,
      });
    case "delete_checklist_item":
      await trello.deleteCheckItem({
        checklistId: args.checklistId,
        checkItemId: args.checkItemId,
      });
      return { ok: true };
    case "delete_checklist":
      await trello.deleteChecklist(args.checklistId);
      return { ok: true };
    case "add_attachment":
      return trello.addAttachment({
        cardId: args.cardId,
        url: args.url,
        name: args.name,
      });
    case "delete_attachment":
      await trello.deleteAttachment(args.cardId, args.attachmentId);
      return { ok: true };
    case "create_board":
      return trello.createBoard({
        name: args.name,
        desc: args.desc,
        defaultLists: args.defaultLists !== false,
      });
    case "update_board": {
      const boardId = await resolveBoardId(args.board);
      const fields = {};
      if (args.name !== undefined) fields.name = args.name;
      if (args.desc !== undefined) fields.desc = args.desc;
      if (args.closed !== undefined) fields.closed = args.closed;
      return trello.updateBoard(boardId, fields);
    }
    case "schedula_moduli":
      return schedulaModuli(args.modules, {
        dueDate: args.due,
        dryRun: Boolean(args.dryRun),
      });
    case "trello_api": {
      const method = String(args.method || "GET").toUpperCase();
      if (!["GET", "POST", "PUT", "DELETE", "HEAD"].includes(method)) {
        throw new Error(`Metodo non consentito: ${method}`);
      }
      let path = String(args.path || "");
      if (!path.startsWith("/")) path = `/${path}`;
      if (path.includes("..") || path.includes("://")) {
        throw new Error("Path non valido");
      }
      let params = {};
      if (args.paramsJson) {
        try {
          params = JSON.parse(args.paramsJson);
        } catch {
          throw new Error("paramsJson non è un JSON valido");
        }
      } else if (args.params && typeof args.params === "object") {
        params = args.params;
      }
      return trello.api(method, path, params);
    }
    default:
      throw new Error(`Tool sconosciuto: ${name}`);
  }
}
