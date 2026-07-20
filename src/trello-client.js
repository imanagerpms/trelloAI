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

  async request(path, { method = "GET", body } = {}) {
    const url = new URL(`${TRELLO_API}${path}`);
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("token", this.token);

    const options = { method, headers: {} };

    if (body && method !== "GET") {
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
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
      throw new Error(message);
    }

    return data;
  }

  listBoards() {
    return this.request("/members/me/boards?filter=open&fields=id,name,url,dateLastActivity,desc");
  }

  getBoard(boardId) {
    return this.request(
      `/boards/${boardId}?fields=id,name,url,desc,dateLastActivity&lists=open&list_fields=id,name,pos&cards=open&card_fields=id,name,desc,due,dueComplete,idList,labels,dateLastActivity,shortUrl,url,idMembers,closed`
    );
  }

  listLists(boardId) {
    return this.request(`/boards/${boardId}/lists?filter=open&fields=id,name,pos`);
  }

  listCards({ boardId, listId, filter = "open" } = {}) {
    if (listId) {
      return this.request(
        `/lists/${listId}/cards?filter=${filter}&fields=id,name,desc,due,dueComplete,idList,labels,dateLastActivity,shortUrl,url,idMembers,closed`
      );
    }
    if (boardId) {
      return this.request(
        `/boards/${boardId}/cards?filter=${filter}&fields=id,name,desc,due,dueComplete,idList,labels,dateLastActivity,shortUrl,url,idMembers,closed`
      );
    }
    throw new Error("Specifica boardId o listId");
  }

  getCard(cardId) {
    return this.request(
      `/cards/${cardId}?fields=id,name,desc,due,dueComplete,idList,labels,dateLastActivity,shortUrl,url,idMembers,closed&actions=commentCard&actions_limit=20&checklists=all&checklist_fields=id,name&members=true&member_fields=fullName,username`
    );
  }

  createCard({ idList, name, desc, due, idMembers, idLabels }) {
    const body = { idList, name };
    if (desc !== undefined) body.desc = desc;
    if (due !== undefined) body.due = due;
    if (idMembers?.length) body.idMembers = idMembers.join(",");
    if (idLabels?.length) body.idLabels = idLabels.join(",");
    return this.request("/cards", { method: "POST", body });
  }

  updateCard(cardId, fields) {
    const allowed = ["name", "desc", "due", "dueComplete", "idList", "closed", "idMembers", "idLabels"];
    const body = {};
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        if (key === "due" && fields[key] === null) {
          body[key] = "";
        } else {
          body[key] = Array.isArray(fields[key]) ? fields[key].join(",") : fields[key];
        }
      }
    }
    return this.request(`/cards/${cardId}`, { method: "PUT", body });
  }

  moveCard(cardId, idList) {
    return this.updateCard(cardId, { idList });
  }

  addComment(cardId, text) {
    return this.request(`/cards/${cardId}/actions/comments`, {
      method: "POST",
      body: { text },
    });
  }

  archiveCard(cardId) {
    return this.updateCard(cardId, { closed: true });
  }

  searchBoard(boardId, query) {
    const encoded = encodeURIComponent(query);
    return this.request(
      `/search?query=${encoded}&idBoards=${boardId}&modelTypes=cards&cards_limit=50&card_fields=id,name,desc,due,idList,labels,dateLastActivity,shortUrl,url,closed`
    );
  }

  getBoardActions(boardId, limit = 20) {
    return this.request(
      `/boards/${boardId}/actions?filter=createCard,updateCard,commentCard,moveCardToBoard,moveCardFromBoard&limit=${limit}`
    );
  }

  getLabels(boardId) {
    return this.request(`/boards/${boardId}/labels?fields=id,name,color`);
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
