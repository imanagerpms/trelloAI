import { toUserFacingError } from "./user-errors.js";

const TRELLO_API = "https://api.trello.com/1";

export class TrelloClient {
  constructor(apiKey, token) {
    if (!apiKey || !token) {
      throw new Error(
        "Credenziali Trello mancanti. Imposta TRELLO_API_KEY e TRELLO_TOKEN nel file .env"
      );
    }
    this.apiKey = apiKey;
    this.token = token;
  }

  /**
   * Chiamata generica all'API Trello.
   * I parametri finiscono in query string (stile Trello); body JSON opzionale.
   */
  async request(path, { method = "GET", body, params } = {}) {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${TRELLO_API}${normalized}`);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("token", this.token);

    if (params && typeof params === "object") {
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
      }
    }

    const options = { method, headers: {} };

    if (body !== undefined && method !== "GET" && method !== "HEAD") {
      options.headers["Content-Type"] = "application/json";
      options.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(url, options);
    } catch (err) {
      throw toUserFacingError(err, { service: "trello" });
    }
    const text = await response.text();

    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!response.ok) {
      const message =
        typeof data === "object" && data?.message
          ? data.message
          : `Trello API error ${response.status}`;
      throw toUserFacingError(new Error(message), {
        service: "trello",
        status: response.status,
      });
    }

    return data;
  }

  /** Escape hatch: qualsiasi endpoint REST documentato da Trello. */
  api(method, path, params = {}) {
    return this.request(path, { method: method.toUpperCase(), params });
  }

  getMe() {
    return this.request("/members/me", {
      params: { fields: "id,fullName,username,url" },
    });
  }

  listBoards(filter = "open") {
    return this.request("/members/me/boards", {
      params: {
        filter,
        fields: "id,name,url,dateLastActivity,desc,closed,shortUrl",
      },
    });
  }

  getBoard(boardId) {
    return this.request(`/boards/${boardId}`, {
      params: {
        fields: "id,name,url,desc,dateLastActivity,closed,shortUrl",
        lists: "open",
        list_fields: "id,name,pos,closed",
        cards: "open",
        card_fields:
          "id,name,desc,due,dueComplete,idList,labels,dateLastActivity,shortUrl,url,idMembers,closed,idLabels",
      },
    });
  }

  createBoard({ name, desc, defaultLists = true, idOrganizationSource }) {
    const params = { name, defaultLists };
    if (desc !== undefined) params.desc = desc;
    if (idOrganizationSource) params.idOrganization = idOrganizationSource;
    return this.request("/boards", { method: "POST", params });
  }

  updateBoard(boardId, fields) {
    return this.request(`/boards/${boardId}`, { method: "PUT", params: fields });
  }

  closeBoard(boardId) {
    return this.updateBoard(boardId, { closed: true });
  }

  listLists(boardId, filter = "open") {
    return this.request(`/boards/${boardId}/lists`, {
      params: { filter, fields: "id,name,pos,closed" },
    });
  }

  createList({ idBoard, name, pos = "bottom" }) {
    return this.request("/lists", {
      method: "POST",
      params: { idBoard, name, pos },
    });
  }

  updateList(listId, fields) {
    return this.request(`/lists/${listId}`, { method: "PUT", params: fields });
  }

  archiveList(listId) {
    return this.updateList(listId, { closed: true });
  }

  listCards({ boardId, listId, filter = "open" } = {}) {
    const fields =
      "id,name,desc,due,dueComplete,idList,labels,dateLastActivity,shortUrl,url,idMembers,closed,idLabels";
    if (listId) {
      return this.request(`/lists/${listId}/cards`, { params: { filter, fields } });
    }
    if (boardId) {
      return this.request(`/boards/${boardId}/cards`, { params: { filter, fields } });
    }
    throw new Error("Specifica boardId o listId");
  }

  getCard(cardId) {
    return this.request(`/cards/${cardId}`, {
      params: {
        fields:
          "id,name,desc,due,dueComplete,idList,labels,dateLastActivity,shortUrl,url,idMembers,closed,idLabels,idBoard",
        actions: "commentCard",
        actions_limit: 20,
        checklists: "all",
        checklist_fields: "id,name",
        members: true,
        member_fields: "fullName,username",
        attachments: true,
        attachment_fields: "id,name,url,bytes,mimeType,date",
      },
    });
  }

  createCard({ idList, name, desc, due, idMembers, idLabels, pos }) {
    const params = { idList, name };
    if (desc !== undefined) params.desc = desc;
    if (due !== undefined) params.due = due;
    if (idMembers?.length) params.idMembers = idMembers.join(",");
    if (idLabels?.length) params.idLabels = idLabels.join(",");
    if (pos !== undefined) params.pos = pos;
    return this.request("/cards", { method: "POST", params });
  }

  updateCard(cardId, fields) {
    const allowed = [
      "name",
      "desc",
      "due",
      "dueComplete",
      "idList",
      "closed",
      "idMembers",
      "idLabels",
      "pos",
      "subscribed",
    ];
    const params = {};
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        if (key === "due" && fields[key] === null) {
          params[key] = "";
        } else {
          params[key] = Array.isArray(fields[key])
            ? fields[key].join(",")
            : fields[key];
        }
      }
    }
    return this.request(`/cards/${cardId}`, { method: "PUT", params });
  }

  moveCard(cardId, idList) {
    return this.updateCard(cardId, { idList });
  }

  archiveCard(cardId) {
    return this.updateCard(cardId, { closed: true });
  }

  unarchiveCard(cardId) {
    return this.updateCard(cardId, { closed: false });
  }

  deleteCard(cardId) {
    return this.request(`/cards/${cardId}`, { method: "DELETE" });
  }

  copyCard({ idList, idCardSource, name, keepFromSource = "all" }) {
    const params = { idList, idCardSource, keepFromSource };
    if (name) params.name = name;
    return this.request("/cards", { method: "POST", params });
  }

  addComment(cardId, text) {
    return this.request(`/cards/${cardId}/actions/comments`, {
      method: "POST",
      params: { text },
    });
  }

  updateComment(actionId, text) {
    return this.request(`/actions/${actionId}`, {
      method: "PUT",
      params: { text },
    });
  }

  deleteComment(actionId) {
    return this.request(`/actions/${actionId}`, { method: "DELETE" });
  }

  addMemberToCard(cardId, memberId) {
    return this.request(`/cards/${cardId}/idMembers`, {
      method: "POST",
      params: { value: memberId },
    });
  }

  removeMemberFromCard(cardId, memberId) {
    return this.request(`/cards/${cardId}/idMembers/${memberId}`, {
      method: "DELETE",
    });
  }

  addLabelToCard(cardId, labelId) {
    return this.request(`/cards/${cardId}/idLabels`, {
      method: "POST",
      params: { value: labelId },
    });
  }

  removeLabelFromCard(cardId, labelId) {
    return this.request(`/cards/${cardId}/idLabels/${labelId}`, {
      method: "DELETE",
    });
  }

  getLabels(boardId) {
    return this.request(`/boards/${boardId}/labels`, {
      params: { fields: "id,name,color" },
    });
  }

  createLabel({ idBoard, name, color }) {
    const params = { idBoard, color: color || "null" };
    if (name) params.name = name;
    return this.request("/labels", { method: "POST", params });
  }

  updateLabel(labelId, fields) {
    return this.request(`/labels/${labelId}`, { method: "PUT", params: fields });
  }

  deleteLabel(labelId) {
    return this.request(`/labels/${labelId}`, { method: "DELETE" });
  }

  getBoardMembers(boardId) {
    return this.request(`/boards/${boardId}/members`, {
      params: { fields: "id,fullName,username" },
    });
  }

  createChecklist({ idCard, name }) {
    return this.request("/checklists", {
      method: "POST",
      params: { idCard, name },
    });
  }

  addCheckItem({ checklistId, name, checked = false }) {
    return this.request(`/checklists/${checklistId}/checkItems`, {
      method: "POST",
      params: { name, checked },
    });
  }

  updateCheckItem({ cardId, checkItemId, name, state }) {
    const params = {};
    if (name !== undefined) params.name = name;
    if (state !== undefined) params.state = state;
    return this.request(`/cards/${cardId}/checkItem/${checkItemId}`, {
      method: "PUT",
      params,
    });
  }

  deleteCheckItem({ checklistId, checkItemId }) {
    return this.request(`/checklists/${checklistId}/checkItems/${checkItemId}`, {
      method: "DELETE",
    });
  }

  deleteChecklist(checklistId) {
    return this.request(`/checklists/${checklistId}`, { method: "DELETE" });
  }

  addAttachment({ cardId, url, name }) {
    const params = { url };
    if (name) params.name = name;
    return this.request(`/cards/${cardId}/attachments`, {
      method: "POST",
      params,
    });
  }

  deleteAttachment(cardId, attachmentId) {
    return this.request(`/cards/${cardId}/attachments/${attachmentId}`, {
      method: "DELETE",
    });
  }

  searchBoard(boardId, query) {
    return this.request("/search", {
      params: {
        query,
        idBoards: boardId,
        modelTypes: "cards",
        cards_limit: 50,
        card_fields:
          "id,name,desc,due,idList,labels,dateLastActivity,shortUrl,url,closed,idBoard",
      },
    });
  }

  search({ query, idBoards, modelTypes = "cards", cardsLimit = 50 }) {
    const params = {
      query,
      modelTypes,
      cards_limit: cardsLimit,
      card_fields:
        "id,name,desc,due,idList,labels,dateLastActivity,shortUrl,url,closed,idBoard",
    };
    if (idBoards) params.idBoards = Array.isArray(idBoards) ? idBoards.join(",") : idBoards;
    return this.request("/search", { params });
  }

  getBoardActions(boardId, limit = 20) {
    return this.request(`/boards/${boardId}/actions`, {
      params: {
        filter: "createCard,updateCard,commentCard,addMemberToCard,addAttachmentToCard,updateCheckItemStateOnCard",
        limit,
      },
    });
  }
}

export function formatCard(card, listNameById = {}) {
  const labels = (card.labels || [])
    .map((l) => l.name || l.color)
    .filter(Boolean)
    .join(", ");

  return {
    id: card.id,
    name: card.name,
    list: listNameById[card.idList] || card.idList,
    due: card.due || null,
    dueComplete: card.dueComplete ?? false,
    labels: labels || null,
    lastActivity: card.dateLastActivity,
    url: card.shortUrl || card.url,
    desc: card.desc ? card.desc.slice(0, 200) + (card.desc.length > 200 ? "…" : "") : null,
    closed: card.closed ?? false,
  };
}

export function formatBoardOverview(board) {
  const listNameById = Object.fromEntries((board.lists || []).map((l) => [l.id, l.name]));

  const cardsByList = {};
  for (const list of board.lists || []) {
    cardsByList[list.id] = [];
  }
  for (const card of board.cards || []) {
    if (!cardsByList[card.idList]) cardsByList[card.idList] = [];
    cardsByList[card.idList].push(formatCard(card, listNameById));
  }

  return {
    id: board.id,
    name: board.name,
    url: board.url,
    desc: board.desc,
    lastActivity: board.dateLastActivity,
    lists: (board.lists || []).map((list) => ({
      id: list.id,
      name: list.name,
      cards: cardsByList[list.id] || [],
    })),
  };
}
