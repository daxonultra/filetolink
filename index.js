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

// Load/Save session
function loadSession() {
  if (fs.existsSync("session.txt")) {
    return new StringSession(fs.readFileSync("session.txt", "utf-8").trim());
  }
  return new StringSession("");
}

function saveSession(client) {
  fs.writeFileSync("session.txt", client.session.save());
}

// File storage
const fileStore = new Map();

// Telegram client
const client = new TelegramClient(loadSession(), API_ID, API_HASH, {
  connectionRetries: 5,
});

// Express app
const app = express();

// Simple root route
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

    const messages = await client.getMessages(BIN_CHANNEL, { ids: [data.messageId] });
    const buffer = await client.downloadMedia(messages[0], {});

    res.setHeader("Content-Type", data.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${data.fileName}"`);
    res.send(buffer);
  } catch (e) {
    res.status(500).send("Error");
  }
});

// Main
async function main() {
  // Start web server
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Start bot
  await client.start({ botAuthToken: BOT_TOKEN });
  saveSession(client);
  console.log("Bot started");

  // Handle files
  client.addEventHandler(async (event) => {
    if (!event.message?.document) return;

    const msg = event.message;
    const file = msg.document;
    const fileName = file.attributes?.find((a) => a.fileName)?.fileName || "file";

    // Forward to channel
    const fwd = await client.forwardMessages(BIN_CHANNEL, {
      messages: [msg.id],
      fromPeer: msg.chatId,
    });

    // Store file info
    const hash = file.id.toString().slice(-6);
    const key = hash + file.id;
    
    fileStore.set(key, {
      messageId: fwd[0].id,
      fileName: fileName,
      mimeType: file.mimeType,
    });

    // Send link
    const link = `${BASE_URL}/file/${key}`;
    await client.sendMessage(msg.chatId, {
      message: `File: ${fileName}\nLink: ${link}`,
      replyTo: msg.id,
    });
  }, new NewMessage({}));
}

main().catch(console.error);
