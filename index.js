import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import { Api } from "telegram";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;
const BOT_TOKEN = process.env.BOT_TOKEN;
const BIN_CHANNEL = process.env.BIN_CHANNEL;
const BASE_URL = process.env.SERVER_URL;
const PORT = 3000;

// Session file path
const SESSION_FILE = "session.txt";

// File store: hash -> {fileId, fileName, fileSize, mimeType, messageId}
const fileStore = new Map();

// ============ SESSION MANAGEMENT ============

function loadSession() {
  if (fs.existsSync(SESSION_FILE)) {
    const sessionString = fs.readFileSync(SESSION_FILE, "utf-8").trim();
    if (sessionString) {
      console.log("✅ Found existing session");
      return new StringSession(sessionString);
    }
  }
  console.log("📝 Creating new session");
  return new StringSession("");
}

function saveSession(client) {
  const sessionString = client.session.save();
  fs.writeFileSync(SESSION_FILE, sessionString);
  console.log("💾 Session saved to", SESSION_FILE);
}

// ============ TELEGRAM CLIENT ============

const stringSession = loadSession();
const client = new TelegramClient(stringSession, API_ID, API_HASH, {
  connectionRetries: 5,
  retryDelay: 1000,
  autoReconnect: true,
});

// ============ HELPERS ============

function generateHash(fileId) {
  return fileId.slice(-6);
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function getFileLink(hash, fileId) {
  return `${BASE_URL}/file/${hash}${fileId}`;
}

function getWatchLink(hash, fileId) {
  return `${BASE_URL}/watch/${hash}${fileId}`;
}

// ============ BOT HANDLERS ============

async function handleFile(event, fileType) {
  const message = event.message;
  const chatId = message.chatId;

  try {
    let file;
    let fileName;
    let fileSize;
    let mimeType;

    // Extract file info based on type
    if (fileType === "document") {
      file = message.document;
      fileName = file.attributes?.find((a) => a.fileName)?.fileName || `file_${Date.now()}`;
      fileSize = file.size;
      mimeType = file.mimeType;
    } else if (fileType === "video") {
      file = message.video;
      fileName = file.attributes?.find((a) => a.fileName)?.fileName || `video_${Date.now()}.mp4`;
      fileSize = file.size;
      mimeType = file.mimeType || "video/mp4";
    } else if (fileType === "audio") {
      file = message.audio;
      fileName = file.attributes?.find((a) => a.fileName)?.fileName || `audio_${Date.now()}.mp3`;
      fileSize = file.size;
      mimeType = file.mimeType || "audio/mpeg";
    } else if (fileType === "photo") {
      file = message.photo;
      fileName = `photo_${Date.now()}.jpg`;
      fileSize = file.sizes?.[file.sizes.length - 1]?.size || 0;
      mimeType = "image/jpeg";
    } else {
      await client.sendMessage(chatId, {
        message: "❌ Unsupported file type",
        replyTo: message.id,
      });
      return;
    }

    const statusMsg = await client.sendMessage(chatId, {
      message: "⏳ Processing file...",
      replyTo: message.id,
    });

    // Forward to bin channel
    const forwardedMsg = await client.forwardMessages(BIN_CHANNEL, {
      messages: [message.id],
      fromPeer: chatId,
    });

    const forwardedMsgId = forwardedMsg[0].id;

    // Generate hash and store
    const hash = generateHash(file.id.toString());
    const storeKey = hash + file.id;

    fileStore.set(storeKey, {
      fileId: file.id.toString(),
      fileName: fileName,
      fileSize: fileSize,
      mimeType: mimeType,
      messageId: forwardedMsgId,
      fileType: fileType,
    });

    const directLink = getFileLink(hash, file.id);
    const watchLink = getWatchLink(hash, file.id);

    const typeEmoji =
      fileType === "video" ? "🎬" : fileType === "audio" ? "🎵" : fileType === "photo" ? "🖼️" : "📁";

    await client.editMessage(chatId, {
      message: statusMsg.id,
      text: `✅ <b>File Processed!</b>

${typeEmoji} <b>Name:</b> <code>${fileName}</code>
📊 <b>Size:</b> ${formatBytes(fileSize)}
🔑 <b>Hash:</b> <code>${hash}</code>

<b>🔗 Direct Download Link:</b>
<code>${directLink}</code>

${fileType === "video" || fileType === "audio" ? `<b>📺 Watch/Listen Online:</b>\n<code>${watchLink}</code>\n\n` : ""}📝 <i>Link will work as long as file exists in storage channel</i>`,
      parseMode: "html",
    });

    console.log(`✅ Processed ${fileType}: ${fileName} (${hash})`);
  } catch (error) {
    console.error("❌ Error handling file:", error);
    await client.sendMessage(chatId, {
      message: `❌ Error: ${error.message}`,
      replyTo: message.id,
    });
  }
}

// ============ EXPRESS WEB SERVER ============

const app = express();

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>FileStream Bot</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }
        .container {
          background: rgba(255, 255, 255, 0.1);
          padding: 50px;
          border-radius: 20px;
          text-align: center;
          backdrop-filter: blur(10px);
          box-shadow: 0 8px 32px rgba(0,0,0,0.3);
          max-width: 600px;
        }
        .status {
          background: #10b981;
          padding: 12px 25px;
          border-radius: 50px;
          display: inline-block;
          margin: 20px 0;
          font-weight: bold;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        h1 { font-size: 2.5em; margin-bottom: 20px; }
        p { font-size: 1.2em; margin: 10px 0; opacity: 0.9; }
        .info {
          margin-top: 30px;
          padding: 20px;
          background: rgba(0,0,0,0.2);
          border-radius: 10px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🚀 FileStream Bot</h1>
        <div class="status">✅ Server Online</div>
        <p>Telegram File Streaming Service</p>
        <div class="info">
          <p><strong>Total Files:</strong> ${fileStore.size}</p>
          <p><small>Send files to the bot to get direct links</small></p>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get("/health", (req, res) => {
  res.send("OK");
});

app.get("/file/:id", async (req, res) => {
  try {
    const fileData = fileStore.get(req.params.id);

    if (!fileData) {
      return res.status(404).send("File not found");
    }

    // Get file from bin channel
    const messages = await client.getMessages(BIN_CHANNEL, {
      ids: [fileData.messageId],
    });

    if (!messages || messages.length === 0) {
      return res.status(404).send("File not found in storage");
    }

    const message = messages[0];
    let media;

    if (message.document) media = message.document;
    else if (message.video) media = message.video;
    else if (message.audio) media = message.audio;
    else if (message.photo) media = message.photo;
    else return res.status(404).send("No media found");

    // Get Telegram CDN link
    const buffer = await client.downloadMedia(message, {});

    // Set headers
    res.setHeader("Content-Type", fileData.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${fileData.fileName}"`);
    res.setHeader("Content-Length", buffer.length);

    res.send(buffer);
  } catch (error) {
    console.error("Error serving file:", error);
    res.status(500).send("Error serving file");
  }
});

app.get("/watch/:id", async (req, res) => {
  try {
    const fileData = fileStore.get(req.params.id);

    if (!fileData) {
      return res.status(404).send("File not found");
    }

    const directLink = getFileLink(req.params.id.slice(0, 6), req.params.id.slice(6));

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${fileData.fileName}</title>
        <meta charset="UTF-8">
        <style>
          body {
            margin: 0;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            font-family: Arial;
          }
          video, audio {
            max-width: 100%;
            max-height: 100vh;
          }
          .container {
            text-align: center;
            color: white;
          }
          a {
            color: #60a5fa;
            text-decoration: none;
            margin-top: 20px;
            display: inline-block;
          }
        </style>
      </head>
      <body>
        <div class="container">
          ${
            fileData.fileType === "video"
              ? `<video controls src="${directLink}"></video>`
              : fileData.fileType === "audio"
              ? `<audio controls src="${directLink}"></audio>`
              : `<p>Preview not available</p>`
          }
          <br>
          <a href="${directLink}" download>⬇️ Download ${fileData.fileName}</a>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("Error rendering watch page:", error);
    res.status(500).send("Error loading file");
  }
});

// ============ MAIN STARTUP ============

async function main() {
  try {
    console.log("🚀 Starting Telegram FileStream Bot...\n");

    // Start web server first
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`✅ Web server running on http://0.0.0.0:${PORT}`);
    });

    // Start Telegram client
    console.log("📱 Connecting to Telegram...");

    await client.start({
      botAuthToken: BOT_TOKEN,
      onError: (err) => console.error("❌ Auth error:", err),
    });

    // Save session
    saveSession(client);

    console.log("✅ Bot connected successfully!\n");

    // Get bot info
    const me = await client.getMe();
    console.log(`🤖 Bot username: @${me.username}`);
    console.log(`📁 Storage channel: ${BIN_CHANNEL}`);
    console.log(`🔗 Base URL: ${BASE_URL}\n`);

    // Register event handlers
    client.addEventHandler(async (event) => {
      const message = event.message;
      if (!message || !message.text) return;

      const chatId = message.chatId;
      const text = message.text.trim();

      if (text === "/start") {
        await client.sendMessage(chatId, {
          message: `🚀 <b>FileStream Bot</b>

Send me any file and get a direct download link!

<b>✨ Supported:</b>
📁 Documents
🎬 Videos  
🎵 Audio
🖼️ Photos

<b>📊 Stats:</b>
Files stored: ${fileStore.size}

Just send a file to get started! 🎯`,
          parseMode: "html",
        });
      }
    }, new NewMessage({}));

    // Handle documents
    client.addEventHandler(async (event) => {
      if (event.message?.document) {
        await handleFile(event, "document");
      }
    }, new NewMessage({}));

    // Handle videos
    client.addEventHandler(async (event) => {
      if (event.message?.video) {
        await handleFile(event, "video");
      }
    }, new NewMessage({}));

    // Handle audio
    client.addEventHandler(async (event) => {
      if (event.message?.audio) {
        await handleFile(event, "audio");
      }
    }, new NewMessage({}));

    // Handle photos
    client.addEventHandler(async (event) => {
      if (event.message?.photo) {
        await handleFile(event, "photo");
      }
    }, new NewMessage({}));

    console.log("📡 Bot is ready and listening for files!\n");
  } catch (error) {
    console.error("❌ Startup error:", error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down...");
  await client.disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down...");
  await client.disconnect();
  process.exit(0);
});

main().catch(console.error);
