/**
 * Prova connessione Telegram Bot (long polling locale).
 *
 * Setup:
 * 1. Apri Telegram → cerca @BotFather → /newbot → copia il token
 * 2. Metti TELEGRAM_BOT_TOKEN=... nel file .env
 * 3. (Gruppo) /setprivacy → Disable, poi aggiungi il bot al gruppo
 * 4. npm run telegram-test
 * 5. Scrivi al bot (o nel gruppo): "NR1 prova"
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env") });

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error(
    "Manca TELEGRAM_BOT_TOKEN nel .env\n" +
      "1. Apri @BotFather su Telegram\n" +
      "2. /newbot → segui le istruzioni\n" +
      "3. Aggiungi: TELEGRAM_BOT_TOKEN=123456:ABC...\n"
  );
  process.exit(1);
}

const API = `https://api.telegram.org/bot${token}`;

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

function describeMessage(msg) {
  const from = msg.from
    ? [msg.from.first_name, msg.from.last_name, msg.from.username && `@${msg.from.username}`]
        .filter(Boolean)
        .join(" ")
    : "?";
  const chat =
    msg.chat.type === "private"
      ? `privato con ${from}`
      : `${msg.chat.type} "${msg.chat.title || msg.chat.id}"`;
  const text = msg.text || msg.caption || "(senza testo)";
  const photos = msg.photo?.length ? ` + ${msg.photo.length} foto` : "";
  return { chat, from, text, photos, chatId: msg.chat.id };
}

let offset = 0;

console.log("Connessione a Telegram…");
const me = await api("getMe");
console.log(`Bot attivo: @${me.username} (${me.first_name})`);
console.log("In ascolto. Scrivi al bot su Telegram (Ctrl+C per uscire).\n");

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

      const d = describeMessage(msg);
      console.log("────────────────────────────────");
      console.log(`Chat: ${d.chat} (id: ${d.chatId})`);
      console.log(`Da:   ${d.from}`);
      console.log(`Msg:  ${d.text}${d.photos}`);

      // Echo di conferma sulla stessa chat
      await api("sendMessage", {
        chat_id: d.chatId,
        text: `Ricevuto ✓\nModulo/testo: ${d.text}${d.photos ? "\n(foto allegate)" : ""}`,
      });
    }
  } catch (err) {
    console.error("Errore polling:", err.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
}
