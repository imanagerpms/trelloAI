const TOKEN_KEY = "sm_admin_token";

const pages = [
  { id: "overview", label: "Panoramica" },
  { id: "rules", label: "Regole" },
  { id: "accommodations", label: "Strutture" },
  { id: "turni", label: "Pesi turni" },
  { id: "boards", label: "Board Trello" },
  { id: "integrations", label: "Integrazioni" },
];

let state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  rules: [],
  currentRule: null,
  accommodations: null,
  turni: null,
  boards: null,
  secrets: null,
  page: "overview",
};

const $ = (sel) => document.querySelector(sel);

function toast(msg, isErr = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("err", isErr);
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}

async function api(path, opts = {}) {
  const headers = {
    ...(opts.body ? { "Content-Type": "application/json" } : {}),
    ...(opts.headers || {}),
  };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    logout(false);
    throw new Error("Token non valido");
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(data?.error || res.statusText || "Errore");
  return data;
}

function showLogin(err = "") {
  $("#app").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
  const errEl = $("#login-error");
  if (err) {
    errEl.textContent = err;
    errEl.classList.remove("hidden");
  } else {
    errEl.classList.add("hidden");
  }
}

function showApp() {
  $("#login-view").classList.add("hidden");
  $("#app").classList.remove("hidden");
  renderNav();
  renderPage();
}

function logout(clear = true) {
  if (clear) localStorage.removeItem(TOKEN_KEY);
  state.token = "";
  showLogin();
}

function renderNav() {
  const nav = $("#nav");
  nav.innerHTML = pages
    .map(
      (p) =>
        `<button type="button" data-page="${p.id}" class="${
          state.page === p.id ? "active" : ""
        }">${p.label}</button>`
    )
    .join("");
  nav.querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      state.page = btn.dataset.page;
      renderNav();
      renderPage();
    };
  });
}

async function renderPage() {
  const content = $("#content");
  const titles = Object.fromEntries(pages.map((p) => [p.id, p.label]));
  $("#page-title").textContent = titles[state.page] || "";
  content.innerHTML = `<p class="muted">Caricamento…</p>`;
  try {
    if (state.page === "overview") await renderOverview(content);
    else if (state.page === "rules") await renderRules(content);
    else if (state.page === "accommodations") await renderAccommodations(content);
    else if (state.page === "turni") await renderTurni(content);
    else if (state.page === "boards") await renderBoards(content);
    else if (state.page === "integrations") await renderIntegrations(content);
  } catch (e) {
    content.innerHTML = `<p class="err">${e.message}</p>`;
  }
}

async function renderOverview(el) {
  $("#page-sub").textContent =
    "Regole e config usate dal bot per Manutenzioni, Customer care, Pulizie e Interazione clienti.";
  const status = await api("/api/admin/status");
  state.secrets = status.secrets;
  state.rules = status.rules || [];
  el.innerHTML = `
    <div class="card">
      <h2>Aree iManager</h2>
      <ul class="status-list">
        ${state.rules
          .map(
            (r) =>
              `<li><span>${r.title}</span><span class="muted">${r.area}</span></li>`
          )
          .join("")}
      </ul>
    </div>
    <div class="card">
      <h2>Secret (.env) — solo stato</h2>
      <ul class="status-list">
        ${Object.entries(status.secrets || {})
          .map(
            ([k, v]) =>
              `<li><span>${k}</span><span class="pill ${v ? "ok" : "no"}">${
                v ? "ok" : "mancante"
              }</span></li>`
          )
          .join("")}
      </ul>
      <p class="muted" style="margin-top:0.75rem">I secret non si modificano da qui. Usa <code>npm run ship:env</code> sul server.</p>
    </div>
  `;
}

async function renderRules(el) {
  $("#page-sub").textContent =
    "Markdown di policy per area. Salvando, il bot le rilegge al prossimo messaggio.";
  const list = await api("/api/admin/rules");
  state.rules = list.rules || [];
  if (!state.currentRule) state.currentRule = state.rules[0]?.id;
  const rule = state.rules.find((r) => r.id === state.currentRule) || state.rules[0];
  const body = rule ? await api(`/api/admin/rules/${rule.id}`) : { markdown: "" };
  el.innerHTML = `
    <div class="card">
      <div class="field">
        <label>Area</label>
        <select id="rule-select">
          ${state.rules
            .map(
              (r) =>
                `<option value="${r.id}" ${
                  r.id === rule?.id ? "selected" : ""
                }>${r.title}</option>`
            )
            .join("")}
        </select>
      </div>
      <textarea id="rule-body" class="rule">${escapeHtml(body.markdown || "")}</textarea>
      <div class="row-actions">
        <button type="button" class="primary" id="save-rule">Salva regola</button>
      </div>
    </div>
  `;
  $("#rule-select").onchange = async (e) => {
    state.currentRule = e.target.value;
    await renderRules(el);
  };
  $("#save-rule").onclick = async () => {
    try {
      await api(`/api/admin/rules/${state.currentRule}`, {
        method: "PUT",
        body: JSON.stringify({ markdown: $("#rule-body").value }),
      });
      toast("Regola salvata");
    } catch (e) {
      toast(e.message, true);
    }
  };
}

async function renderAccommodations(el) {
  $("#page-sub").textContent =
    "Strutture Octorate: cluster, tipo, spazi comuni, peso appartamento, tragitto Domus Turno.";
  state.accommodations = await api("/api/admin/config/accommodations");
  const rows = Object.entries(state.accommodations.accommodations || {}).map(
    ([id, c]) => ({ id, ...c })
  );
  const master = (state.accommodations.masterAccommodationIds || []).join(", ");
  el.innerHTML = `
    <div class="card">
      <div class="field">
        <label>Master accommodation IDs (esclusi dalle query rete)</label>
        <input id="master-ids" value="${escapeAttr(master)}" />
      </div>
      <table class="acc">
        <thead>
          <tr>
            <th>ID</th><th>Code</th><th>Nome</th><th>Cluster</th><th>Tipo</th>
            <th>Bagno in camera</th><th>Peso apt</th><th>Tragitto</th><th>Spazi comuni</th><th></th>
          </tr>
        </thead>
        <tbody id="acc-body">
          ${rows.map((r) => accRowHtml(r)).join("")}
        </tbody>
      </table>
      <div class="row-actions">
        <button type="button" id="add-acc">Aggiungi struttura</button>
        <button type="button" class="primary" id="save-acc">Salva strutture</button>
      </div>
    </div>
  `;
  $("#add-acc").onclick = () => {
    $("#acc-body").insertAdjacentHTML(
      "beforeend",
      accRowHtml({
        id: "",
        code: "",
        name: "",
        cluster: "centro",
        tipo: "affittacamere",
        bagnoInCamera: true,
        appartamentoPeso: 1,
        tragittoPeso: "",
        spaziComuni: [],
      })
    );
  };
  $("#save-acc").onclick = async () => {
    try {
      const payload = collectAccommodations();
      await api("/api/admin/config/accommodations", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      toast("Strutture salvate");
    } catch (e) {
      toast(e.message, true);
    }
  };
  el.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = () => btn.closest("tr").remove();
  });
}

function accRowHtml(r) {
  const spazi = Array.isArray(r.spaziComuni) ? r.spaziComuni.join(", ") : "";
  return `<tr>
    <td><input class="mono" data-f="id" value="${escapeAttr(r.id)}" /></td>
    <td><input data-f="code" value="${escapeAttr(r.code || "")}" /></td>
    <td><input data-f="name" value="${escapeAttr(r.name || "")}" /></td>
    <td>
      <select data-f="cluster">
        <option value="centro" ${r.cluster === "centro" ? "selected" : ""}>centro</option>
        <option value="tenerife" ${r.cluster === "tenerife" ? "selected" : ""}>tenerife</option>
      </select>
    </td>
    <td>
      <select data-f="tipo">
        <option value="affittacamere" ${r.tipo === "affittacamere" ? "selected" : ""}>affittacamere</option>
        <option value="appartamento" ${r.tipo === "appartamento" ? "selected" : ""}>appartamento</option>
      </select>
    </td>
    <td>
      <select data-f="bagnoInCamera">
        <option value="true" ${r.bagnoInCamera ? "selected" : ""}>sì</option>
        <option value="false" ${!r.bagnoInCamera ? "selected" : ""}>no</option>
      </select>
    </td>
    <td><input data-f="appartamentoPeso" type="number" step="0.1" value="${escapeAttr(
      r.appartamentoPeso ?? 1
    )}" /></td>
    <td><input data-f="tragittoPeso" type="number" step="0.1" value="${escapeAttr(
      r.tragittoPeso ?? ""
    )}" placeholder="—" /></td>
    <td><input data-f="spaziComuni" value="${escapeAttr(spazi)}" placeholder="CUCINA, CORRIDOIO" /></td>
    <td><button type="button" class="danger" data-del>✕</button></td>
  </tr>`;
}

function collectAccommodations() {
  const accommodations = {};
  for (const tr of document.querySelectorAll("#acc-body tr")) {
    const get = (f) => tr.querySelector(`[data-f="${f}"]`)?.value?.trim() ?? "";
    const id = get("id");
    if (!id) continue;
    const tragitto = get("tragittoPeso");
    const spaziRaw = get("spaziComuni");
    accommodations[id] = {
      code: get("code"),
      name: get("name"),
      cluster: get("cluster"),
      tipo: get("tipo"),
      bagnoInCamera: get("bagnoInCamera") === "true",
      appartamentoPeso: Number(get("appartamentoPeso") || 1),
      spaziComuni: spaziRaw
        ? spaziRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
    };
    if (tragitto !== "") accommodations[id].tragittoPeso = Number(tragitto);
  }
  const master = ($("#master-ids").value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { masterAccommodationIds: master, accommodations };
}

async function renderTurni(el) {
  $("#page-sub").textContent = "Pesi carico, cap giornaliero e default staff.";
  state.turni = await api("/api/admin/config/turni");
  const w = state.turni.weights || {};
  const s = state.turni.spaziComuniPesi || {};
  const staff = state.turni.staffDefaults || {};
  el.innerHTML = `
    <div class="card">
      <h2>Cap e pesi camera</h2>
      <div class="grid-2">
        ${numField("maxCarico", "Max carico cameriera", state.turni.maxCarico)}
        ${numField("CAMERA_BAGNO_IN_CAMERA", "Camera bagno in camera", w.CAMERA_BAGNO_IN_CAMERA)}
        ${numField("CAMERA_BAGNO_CONDIVISO", "Camera bagno condiviso", w.CAMERA_BAGNO_CONDIVISO)}
        ${numField("FERMATA_SEMPLICE", "Fermata semplice", w.FERMATA_SEMPLICE)}
        ${numField("FERMATA_CON_CAMBIO_FACTOR", "Fattore fermata con cambio", w.FERMATA_CON_CAMBIO_FACTOR)}
        ${numField("TRAGITTO_DOMUS_TURNO", "Tragitto Domus Turno", w.TRAGITTO_DOMUS_TURNO)}
        ${numField("VUOTA", "Vuota", w.VUOTA)}
      </div>
    </div>
    <div class="card">
      <h2>Spazi comuni</h2>
      <div class="grid-2">
        ${Object.keys(s)
          .map((k) => numField(`sc:${k}`, k, s[k]))
          .join("")}
      </div>
    </div>
    <div class="card">
      <h2>Staff default</h2>
      <div class="grid-2">
        ${numField("cameriereCentro", "Cameriere Roma (n)", staff.cameriereCentro)}
        <div class="field"><label>Tenerife nomi (csv)</label>
          <input id="tenerifeNomi" value="${escapeAttr((staff.tenerifeNomi || []).join(", "))}" /></div>
        <div class="field"><label>Manutentore Tenerife</label>
          <input id="manutentoreTenerifeNome" value="${escapeAttr(
            staff.manutentoreTenerifeNome || "Mario"
          )}" /></div>
        <div class="field"><label>Manutentore Roma</label>
          <input id="manutentoreRomaNome" value="${escapeAttr(
            staff.manutentoreRomaNome || "Manutentore"
          )}" /></div>
      </div>
      <div class="row-actions">
        <button type="button" class="primary" id="save-turni">Salva pesi</button>
      </div>
    </div>
  `;
  $("#save-turni").onclick = async () => {
    try {
      const payload = {
        maxCarico: Number($("#f-maxCarico").value),
        weights: {
          VUOTA: Number($("#f-VUOTA").value),
          FERMATA_SEMPLICE: Number($("#f-FERMATA_SEMPLICE").value),
          FERMATA_CON_CAMBIO_FACTOR: Number($("#f-FERMATA_CON_CAMBIO_FACTOR").value),
          CAMERA_BAGNO_CONDIVISO: Number($("#f-CAMERA_BAGNO_CONDIVISO").value),
          CAMERA_BAGNO_IN_CAMERA: Number($("#f-CAMERA_BAGNO_IN_CAMERA").value),
          TRAGITTO_DOMUS_TURNO: Number($("#f-TRAGITTO_DOMUS_TURNO").value),
        },
        spaziComuniPesi: Object.fromEntries(
          Object.keys(s).map((k) => [k, Number($(`#f-sc\\:${CSS.escape(k)}`)?.value ?? $(`[id="f-sc:${k}"]`).value)])
        ),
        staffDefaults: {
          cameriereCentro: Number($("#f-cameriereCentro").value),
          tenerifeNomi: ($("#tenerifeNomi").value || "")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          manutentoreTenerifeNome: $("#manutentoreTenerifeNome").value.trim(),
          manutentoreRomaNome: $("#manutentoreRomaNome").value.trim(),
        },
      };
      // Fix spazi comuni field ids with colon
      const sc = {};
      for (const k of Object.keys(s)) {
        const input = document.getElementById(`f-sc:${k}`);
        sc[k] = Number(input?.value ?? 0);
      }
      payload.spaziComuniPesi = sc;
      await api("/api/admin/config/turni", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      toast("Pesi salvati");
    } catch (e) {
      toast(e.message, true);
    }
  };
}

function numField(id, label, value) {
  return `<div class="field"><label>${label}</label>
    <input id="f-${id}" type="number" step="0.1" value="${escapeAttr(value ?? 0)}" /></div>`;
}

async function renderBoards(el) {
  $("#page-sub").textContent =
    "Default board/membri. Se presente, la variabile .env ha priorità.";
  state.boards = await api("/api/admin/config/boards");
  const boards = state.boards.boards || {};
  const people = state.boards.people || {};
  el.innerHTML = `
    <div class="card">
      <h2>Board</h2>
      ${Object.entries(boards)
        .map(
          ([key, b]) => `
        <div class="grid-2">
          <div class="field"><label>${b.label || key} — ID</label>
            <input data-board="${key}" data-f="id" class="mono" value="${escapeAttr(b.id)}" /></div>
          <div class="field"><label>Env override</label>
            <input value="${escapeAttr(b.envKey || "")}" disabled /></div>
        </div>`
        )
        .join("")}
    </div>
    <div class="card">
      <h2>Persone</h2>
      ${Object.entries(people)
        .map(
          ([key, p]) => `
        <div class="grid-2">
          <div class="field"><label>${p.name || key} — nome</label>
            <input data-person="${key}" data-f="name" value="${escapeAttr(p.name || "")}" /></div>
          <div class="field"><label>Trello member ID</label>
            <input data-person="${key}" data-f="id" class="mono" value="${escapeAttr(p.id || "")}" /></div>
        </div>`
        )
        .join("")}
      <div class="row-actions">
        <button type="button" class="primary" id="save-boards">Salva board</button>
      </div>
    </div>
  `;
  $("#save-boards").onclick = async () => {
    try {
      const next = structuredClone(state.boards);
      for (const input of document.querySelectorAll("[data-board]")) {
        const key = input.dataset.board;
        if (input.dataset.f === "id") next.boards[key].id = input.value.trim();
      }
      for (const input of document.querySelectorAll("[data-person]")) {
        const key = input.dataset.person;
        next.people[key][input.dataset.f] = input.value.trim();
      }
      await api("/api/admin/config/boards", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      toast("Board salvate");
    } catch (e) {
      toast(e.message, true);
    }
  };
}

async function renderIntegrations(el) {
  $("#page-sub").textContent =
    "Collegamenti esterni. AIBridge arriverà qui quando l’API sarà pronta.";
  const status = await api("/api/admin/status");
  const oa = status.octorateAuth || {};
  const oaOk = oa.authenticated && !oa.expired;
  const oaLabel = !oa.authenticated
    ? "non collegato"
    : oa.expired
      ? "scaduto"
      : oa.source === "env"
        ? "ok (env)"
        : "ok";
  const expiresLabel = oa.expiresAt
    ? new Date(oa.expiresAt).toLocaleString("it-IT")
    : oa.source === "env"
      ? "fisso da .env"
      : "—";

  el.innerHTML = `
    <div class="card">
      <h2>Attivi</h2>
      <ul class="status-list">
        <li><span>Octorate MCP / OAuth</span><span class="pill ${
          status.secrets.octorate ? "ok" : "no"
        }">${status.secrets.octorate ? "ok" : "mancante"}</span></li>
        <li><span>Token Octorate</span><span class="pill ${
          oaOk ? "ok" : "no"
        }">${oaLabel}</span></li>
        <li><span>Trello</span><span class="pill ${
          status.secrets.trello ? "ok" : "no"
        }">${status.secrets.trello ? "ok" : "mancante"}</span></li>
        <li><span>Telegram</span><span class="pill ${
          status.secrets.telegram ? "ok" : "no"
        }">${status.secrets.telegram ? "ok" : "mancante"}</span></li>
        <li><span>LLM (OpenAI/Anthropic)</span><span class="pill ${
          status.secrets.openai || status.secrets.anthropic ? "ok" : "no"
        }">${
          status.secrets.openai || status.secrets.anthropic ? "ok" : "mancante"
        }</span></li>
      </ul>
      <p class="muted" style="margin-top:0.75rem">
        Scadenza access token: <strong>${escapeHtml(expiresLabel)}</strong>
        ${oa.hasRefreshToken ? " · refresh disponibile" : " · senza refresh (serve login)"}
      </p>
      <div class="row" style="margin-top:0.75rem;gap:0.5rem;flex-wrap:wrap">
        <button type="button" class="primary" id="btn-octorate-refresh">Rinnova token</button>
        <a class="button-link" href="/oauth/login">Ricollega (login OAuth)</a>
      </div>
      <p class="muted" style="margin-top:0.5rem">
        «Rinnova» usa il refresh_token senza browser. Se fallisce, usa «Ricollega».
      </p>
    </div>
    <div class="card">
      <h2>AIBridge (stub)</h2>
      <p>Accesso alle chat clienti in essere. Variabili previste: <code>AIBRIDGE_API_URL</code>, <code>AIBRIDGE_API_KEY</code>.</p>
      <p>Stato: <span class="pill ${status.secrets.aibridge ? "ok" : "no"}">${
        status.secrets.aibridge ? "configurato" : "non collegato"
      }</span></p>
      <p class="muted">Policy: vedi regola «Interazione clienti».</p>
    </div>
  `;

  const refreshBtn = $("#btn-octorate-refresh");
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      refreshBtn.disabled = true;
      try {
        const res = await api("/api/admin/octorate/refresh", { method: "POST" });
        toast(
          res.octorateAuth?.expiresAt
            ? `Token rinnovato fino a ${new Date(res.octorateAuth.expiresAt).toLocaleString("it-IT")}`
            : "Token rinnovato"
        );
        await renderIntegrations(el);
      } catch (e) {
        toast(
          `${e.message} — apri «Ricollega» se serve un nuovo login`,
          true
        );
        refreshBtn.disabled = false;
      }
    };
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  state.token = $("#token-input").value.trim();
  try {
    await api("/api/admin/status");
    localStorage.setItem(TOKEN_KEY, state.token);
    showApp();
  } catch (err) {
    showLogin(err.message);
  }
};

$("#logout").onclick = () => logout(true);

if (state.token) {
  api("/api/admin/status")
    .then(() => showApp())
    .catch(() => showLogin());
} else {
  showLogin();
}
