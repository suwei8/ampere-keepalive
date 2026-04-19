#!/usr/bin/env node

export async function sendTelegramMessage(token, chatId, text) {
  if (!token) {
    throw new Error("Telegram bot token is required");
  }
  if (!chatId) {
    throw new Error("Telegram chat id is required");
  }
  if (!text) {
    throw new Error("Telegram message text is required");
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Telegram send failed: ${response.status} ${body}`);
  }

  return JSON.parse(body);
}

