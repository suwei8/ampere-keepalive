#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { sendTelegramMessage } from "../lib/telegram.mjs";

function parseArgs(argv) {
  const out = {
    message: "",
    messageFile: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--message") {
      out.message = argv[++i];
    } else if (arg === "--message-file") {
      out.messageFile = path.resolve(process.cwd(), argv[++i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!out.message && !out.messageFile) {
    throw new Error("Either --message or --message-file is required");
  }

  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = args.messageFile ? await fs.readFile(args.messageFile, "utf8") : args.message;
  await sendTelegramMessage(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, text.trim());
  process.stdout.write("telegram_sent\n");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

