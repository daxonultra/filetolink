import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import express from "express";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BIN_CHANNEL = process.env.BIN_CHANNEL;
const BASE_URL = process.env.SERVER_URL;
const PORT = 3000;

// Auto session management
const SESSION_FILE = "session.txt";
let sessionString = "";

if (fs.existsSync(SESSION_FILE)) {
  sessionString = fs.readFileSync(SESSION_FILE, "utf-8").trim();
  console.log("✅ Using existing session");
} else {
  console.log("📝 Will create new session");
}

const client = new TelegramClient(
  new StringSession(sessionString),
  API_ID,
  API_HASH,
  { connectionRetries: 5 }
);

// File storage
const fileStore = new Map();

// Express app
const app = express();

app.get("/", (req, res) => {
  res.send("Bot is running!");
});

app.get("/health", (req, res) => {
  res.send("OK");
});

app.get("/file/:id", async (req, res) => {
  try {
    const data = fileStore.get(req.params.id);
    if (!data) return res.status(404).send("Not found");

    const messages = await client.getMessages(BIN_CHANNEL, {
      ids: [data.messageId],
    });

    if (!messages || !messages[0]) {
      return res.status(404).send("File not found in channel");
    }

    const buffer = await client.downloadMedia(messages[0], {});

    res.setHeader("Content-Type", data.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${data.fileName}"`
    );
    res.send(buffer);
  } catch (e) {
    console.error("File error:", e.message);
    res.status(500).send("Error");
  }
});

// Main
async function main() {
  console.log("🚀 Starting bot...");

  // Start web server first
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server on port ${PORT}`);
  });

  // Start telegram bot
  await client.start({ botAuthToken: BOT_TOKEN });
  console.log("✅ Bot connected");

  // Save session automatically
  const newSession = client.session.save();
  if (newSession !== sessionString) {
    fs.writeFileSync(SESSION_FILE, newSession);
    console.log("💾 Session saved");
  }

  // Handle documents
  client.addEventHandler(async (event) => {
    const msg = event.message;
    if (!msg?.document) return;

    const file = msg.document;
    const fileName =
      file.attributes?.find((a) => a.fileName)?.fileName || "file";

    try {
      console.log(`📥 Processing: ${fileName}`);

      // Forward to bin channel
      const fwd = await client.forwardMessages(BIN_CHANNEL, {
        messages: [msg.id],
        fromPeer: msg.chatId,
      });

      // Generate hash and store
      const hash = file.id.toString().slice(-6);
      const key = hash + file.id;

      fileStore.set(key, {
        messageId: fwd[0].id,
        fileName: fileName,
        mimeType: file.mimeType || "application/octet-stream",
      });

      // Send link
      const link = `${BASE_URL}/file/${key}`;

      await client.sendMessage(msg.chatId, {
        message: `✅ File: ${fileName}\n🔗 Link: ${link}`,
        replyTo: msg.id,
      });

      console.log(`✅ Stored: ${fileName}`);
    } catch (e) {
      console.error("Error:", e.message);
      await client.sendMessage(msg.chatId, {
        message: "❌ Error processing file",
        replyTo: msg.id,
      });
    }
  }, new NewMessage({}));

  console.log("📡 Ready!");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
