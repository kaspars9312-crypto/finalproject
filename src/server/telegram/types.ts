export interface TelegramMessage {
  from: { id: string };
  chat: { id: string; type: "private" };
  text: string;
}
export interface TelegramUpdate { update_id: string; message: TelegramMessage }
export interface Session {
  telegram_user_id: string;
  chat_id: string;
  employee_id_at_start: string;
  flow_type: "SALE" | "EXPENSE";
  step: string;
  draft_payload: Record<string, string>;
  updated_at: string;
}
export interface SavedSubmission {
  id: string;
  reference: string;
  amount_cents: string;
  transaction_type: "SALE" | "EXPENSE";
  status: "PENDING_APPROVAL" | "AWAITING_ALLOCATION" | "ALLOCATED";
  destination: string;
  target_chat_id: string;
}
export type UpdateResult =
  | { outcome: "DUPLICATE" | "CANCELLED" | "UNLINKED" | "FORBIDDEN" | "STALE_SESSION" |
      "NO_SESSION" | "SESSION_CHANGED" | "WRONG_CHAT" | "INVALID" | "DUPLICATE_REFERENCE" | "HELP" }
  | { outcome: "START"; employee_name: string | null; role: string | null }
  | { outcome: "PROMPT"; step: string }
  | { outcome: "SAVED"; transaction: SavedSubmission };

/** Never convert an unsafe JSON number to an apparently exact string. */
export function telegramId(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("Invalid Telegram ID");
    value = String(value);
  }
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) throw new Error("Invalid Telegram ID");
  const id = BigInt(value);
  if (id < -BigInt("9223372036854775808") || id > BigInt("9223372036854775807")) {
    throw new Error("Invalid Telegram ID");
  }
  return id.toString();
}

export function parseUpdate(value: unknown): TelegramUpdate | null {
  if (!value || typeof value !== "object") return null;
  const update = value as Record<string, unknown>;
  const message = update.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object" || typeof message.text !== "string") return null;
  const from = message.from as Record<string, unknown> | undefined;
  const chat = message.chat as Record<string, unknown> | undefined;
  if (!from || !chat || chat.type !== "private" || from.is_bot === true) return null;
  try {
    const updateId = telegramId(update.update_id);
    const userId = telegramId(from.id);
    const chatId = telegramId(chat.id);
    if (BigInt(updateId) < BigInt(0) || BigInt(userId) <= BigInt(0) || BigInt(chatId) === BigInt(0)) return null;
    return { update_id: updateId, message: { from: { id: userId }, chat: { id: chatId, type: "private" }, text: message.text } };
  } catch { return null; }
}
