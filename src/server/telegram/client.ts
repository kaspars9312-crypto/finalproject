import "server-only";
import { telegramId } from "./types";

export class TelegramApiError extends Error {
  constructor(readonly code: "CONFIGURATION" | "DELIVERY_FAILED") {
    super(code === "CONFIGURATION" ? "Telegram is not configured." : "Telegram delivery failed.");
    this.name = "TelegramApiError";
  }
}

/** Raw fetch errors may contain the URL/token. Never retain or log them. */
export async function sendMessage(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new TelegramApiError("CONFIGURATION");
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId(chatId), text }),
      signal: AbortSignal.timeout(5000), cache: "no-store",
    });
    if (!response.ok) throw new TelegramApiError("DELIVERY_FAILED");
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== true) {
      throw new TelegramApiError("DELIVERY_FAILED");
    }
  } catch { throw new TelegramApiError("DELIVERY_FAILED"); }
}
