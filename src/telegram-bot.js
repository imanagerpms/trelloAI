/**
 * Super Manager — Telegram + MCP (Trello locale + Octorate remoto) + LLM.
 *
 * Requisiti .env:
 *   TELEGRAM_BOT_TOKEN, TRELLO_*, ANTHROPIC_API_KEY|OPENAI_API_KEY
 *   OCTORATE_MCP_SECRET (e opz. OCTORATE_MCP_URL, OCTORATE_MCP_PUBLIC)
 *
 * Avvio: npm run telegram
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import {
  hasLlmConfigured,
  runSuperManager,
  shouldIntervene,
} from "./telegram-agent.js";
import { McpHub } from "./mcp-hub.js";
import { startPublicHttpServer } from "./public-http.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Manca TELEGRAM_BOT_TOKEN nel .env");
  process.exit(1);
}
if (!hasLlmConfigured()) {
  console.error(
    "Manca OPENAI_API_KEY o ANTHROPIC_API_KEY nel .env\n" +
      "Serve un LLM affinché Super Manager capisca richieste in linguaggio naturale."
  );
  process.exit(1);
}

const allowed = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || "")
  .split(/[,;\s]+/)
  .map((s) => s.trim())
  .filter(Boolean);

const API = `https://api.telegram.org/bot${token}`;
/** Username Telegram obbligatorio per i tag in gruppo. */
const GROUP_MENTION_USERNAME = "manager_888_bot";
/** @type {Map<number, Array<{role:string,content:string}>>} */
const chatHistory = new Map();
let botUsername = "";

async function api(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`${method}: ${data.description || JSON.stringify(data)}`);
  }
  return data.result;
}

function chunkText(text, max = 4000) {
  if (text.length <= max) return [text];
  const parts = [];
  let rest = text;
  while (rest.length) {
    parts.push(rest.slice(0, max));
    rest = rest.slice(max);
  }
  return parts;
}

async function reply(chatId, text, replyToMessageId) {
  for (const part of chunkText(text)) {
    await api("sendMessage", {
      chat_id: chatId,
      text: part,
      reply_to_message_id: replyToMessageId,
      allow_sending_without_reply: true,
    });
  }
}

function isAllowed(chatId) {
  if (!allowed.length) return true;
  return allowed.includes(String(chatId));
}

function extractText(msg) {
  const base = (msg.text || msg.caption || "").trim();
  const hasPhoto = Boolean(msg.photo?.length);
  if (hasPhoto && base) return `${base}\n[Foto allegata]`;
  if (hasPhoto) return "[Foto allegata senza didascalia]";
  return base;
}

function isMentioned(msg) {
  if (!botUsername) return false;
  const entities = [...(msg.entities || []), ...(msg.caption_entities || [])];
  const text = msg.text || msg.caption || "";
  for (const e of entities) {
    if (e.type === "mention") {
      const mention = text.slice(e.offset, e.offset + e.length);
      if (mention.toLowerCase() === `@${botUsername.toLowerCase()}`) return true;
    }
    if (e.type === "text_mention" && e.user?.is_bot && e.user?.username === botUsername) {
      return true;
    }
  }
  return new RegExp(`@${botUsername}\\b`, "i").test(text);
}

function isReplyToBot(msg) {
  const r = msg.reply_to_message;
  return Boolean(r?.from?.is_bot && r.from.username === botUsername);
}

console.log("Avvio Super Manager…");
console.log("Connessione MCP (Trello + Octorate)…");
const hub = new McpHub();
await hub.connectAll();
console.log(
  "MCP pronti:",
  hub
    .listServers()
    .map((s) => `${s.name}(${s.tools})`)
    .join(", ") || "(nessuno)"
);

startPublicHttpServer({
  onOAuthSuccess: async () => {
    console.log("OAuth Octorate OK — riconnetto MCP octorate…");
    try {
      await hub.connectOctorate();
    } catch (e) {
      console.error("Riconnessione octorate fallita:", e.message);
    }
  },
});

const me = await api("getMe");
botUsername = me.username;
if (botUsername !== GROUP_MENTION_USERNAME) {
  console.warn(
    `Attenzione: username bot @${botUsername} ≠ @${GROUP_MENTION_USERNAME} (tag gruppi)`
  );
}
console.log(`Bot: @${botUsername} (${me.first_name})`);
console.log(`LLM: ${process.env.OPENAI_API_KEY ? "OpenAI" : "Anthropic"}`);
if (allowed.length) {
  console.log(`Chat autorizzate: ${allowed.join(", ")}`);
} else {
  console.log("Attenzione: nessuna TELEGRAM_ALLOWED_CHAT_IDS — accetta chiunque");
}
console.log(
  `In ascolto. In gruppo: tag @${GROUP_MENTION_USERNAME} (o reply al bot).\n`
);

let offset = 0;

process.on("SIGINT", async () => {
  console.log("\nChiusura…");
  await hub.close();
  process.exit(0);
});

while (true) {
  try {
    const updates = await api("getUpdates", {
      offset,
      timeout: 30,
      allowed_updates: ["message"],
    });

    for (const u of updates) {
      offset = u.update_id + 1;
      const msg = u.message;
      if (!msg) continue;

      const chatId = msg.chat.id;
      const chatLabel =
        msg.chat.type === "private"
          ? "privato"
          : `${msg.chat.type} "${msg.chat.title || "?"}"`;
      const from = msg.from
        ? [msg.from.first_name, msg.from.username && `@${msg.from.username}`]
            .filter(Boolean)
            .join(" ")
        : "?";
      const text = extractText(msg);
      const isPrivate = msg.chat.type === "private";
      const mentioned = isMentioned(msg);
      const replyBot = isReplyToBot(msg);

      console.log(`[${chatId}] ${chatLabel} | ${from}: ${(text || "").slice(0, 120)}`);

      if (!isAllowed(chatId)) {
        console.log(
          `  → rifiutato (chat non autorizzata). Per abilitarla aggiungi ${chatId} a TELEGRAM_ALLOWED_CHAT_IDS`
        );
        continue;
      }

      if (!text) continue;

      if (
        !shouldIntervene(text, {
          mentioned,
          isReplyToBot: replyBot,
          isPrivate,
        })
      ) {
        console.log(
          `  → ignorato (in gruppo serve @${GROUP_MENTION_USERNAME} o reply)`
        );
        continue;
      }

      const clean = text
        .replace(new RegExp(`@${botUsername}`, "ig"), "")
        .replace(/^(super\s*manager|manager|sm)[:\s]+/i, "")
        .trim();

      const userPayload = isPrivate
        ? clean || text
        : `[Gruppo — già autorizzato via @${GROUP_MENTION_USERNAME}]\nDa ${from}:\n${clean || text}`;

      try {
        console.log("  → elaboro…");
        await api("sendChatAction", { chat_id: chatId, action: "typing" });
        const history = chatHistory.get(chatId) || [];
        const { reply: answer, history: next, actions } = await runSuperManager(
          hub,
          history,
          userPayload
        );
        chatHistory.set(chatId, next);
        if (actions.length) {
          console.log(
            `  → tools: ${actions.map((a) => `${a.name}${a.ok ? "" : "!"}`).join(", ")}`
          );
        }
        console.log(`  → risposta (${(answer || "").length} char)`);
        await reply(chatId, answer, msg.message_id);
      } catch (err) {
        console.error("  → errore:", err.message);
        await reply(chatId, `Errore: ${err.message}`, msg.message_id);
      }
    }
  } catch (err) {
    console.error("Errore polling:", err.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
