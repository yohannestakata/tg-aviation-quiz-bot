const token = process.env.TELEGRAM_BOT_TOKEN;
const baseUrl = process.env.PUBLIC_BACKEND_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;

if (!token || !baseUrl || !secret) {
  console.error("TELEGRAM_BOT_TOKEN, PUBLIC_BACKEND_URL, and TELEGRAM_WEBHOOK_SECRET are required.");
  process.exit(1);
}

const webhookUrl = `${baseUrl.replace(/\/$/, "")}/telegram/webhook/${encodeURIComponent(secret)}`;
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secretToken || undefined,
    allowed_updates: ["message", "callback_query"]
  })
});

const body = await response.json();
if (!response.ok || !body.ok) {
  console.error("Failed to set Telegram webhook", body);
  process.exit(1);
}

console.log(`Telegram webhook set to ${webhookUrl}`);
