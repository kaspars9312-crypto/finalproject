import "server-only";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { telegramId, type Session, type UpdateResult } from "./types";

export class TelegramPersistenceError extends Error {
  constructor(readonly code: "DATABASE_ERROR" | "FORBIDDEN" | "NOT_FOUND" = "DATABASE_ERROR") {
    super(code === "FORBIDDEN" ? "Only an active manager can link Telegram accounts."
      : code === "NOT_FOUND" ? "The employee or Telegram account was not found. Start the bot first."
        : "Telegram processing could not be confirmed.");
  }
}
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const { data, error } = await createSupabaseAdminClient().rpc(name, args);
    if (error) throw new TelegramPersistenceError(error.code === "BE001" ? "FORBIDDEN" : error.code === "BE002" ? "NOT_FOUND" : "DATABASE_ERROR");
    return data;
  } catch (error) {
    if (error instanceof TelegramPersistenceError) throw error;
    throw new TelegramPersistenceError();
  }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TelegramPersistenceError();
  return value as Record<string, unknown>;
}
export async function readSession(userId: string): Promise<Session | null> {
  const data = await rpc("telegram_read_session", { p_user_id: telegramId(userId) });
  if (data === null) return null;
  const row = record(data);
  if (typeof row.telegram_user_id !== "string" || typeof row.chat_id !== "string" ||
      typeof row.employee_id_at_start !== "string" || typeof row.updated_at !== "string" ||
      typeof row.step !== "string" || !["SALE", "EXPENSE"].includes(String(row.flow_type)) ||
      Object.values(record(row.draft_payload)).some(value => typeof value !== "string")) throw new TelegramPersistenceError();
  return row as unknown as Session;
}
export async function applyUpdate(input: { updateId: string; userId: string; chatId: string;
  command: string; session?: Session | null; value?: string | null }): Promise<UpdateResult> {
  const row = record(await rpc("telegram_apply_update", {
    p_update_id: telegramId(input.updateId), p_user_id: telegramId(input.userId), p_chat_id: telegramId(input.chatId),
    p_command: input.command, p_expected_session: input.session ?? null, p_value: input.value ?? null,
  }));
  if (row.outcome === "SAVED") {
    const tx = record(row.transaction);
    if (!["id", "reference", "amount_cents", "target_chat_id", "destination"].every(key => typeof tx[key] === "string") ||
        !["SALE", "EXPENSE"].includes(String(tx.transaction_type)) ||
        !["PENDING_APPROVAL", "AWAITING_ALLOCATION", "ALLOCATED"].includes(String(tx.status)) ||
        !/^\d+$/.test(String(tx.amount_cents)) || BigInt(String(tx.amount_cents)) < BigInt(1) ||
        BigInt(String(tx.amount_cents)) > BigInt(Number.MAX_SAFE_INTEGER)) throw new TelegramPersistenceError();
    telegramId(tx.target_chat_id);
  } else if (row.outcome === "PROMPT") {
    if (typeof row.step !== "string") throw new TelegramPersistenceError();
  } else if (row.outcome === "START") {
    if ((row.employee_name !== null && typeof row.employee_name !== "string") ||
        (row.role !== null && typeof row.role !== "string")) throw new TelegramPersistenceError();
  } else if (!["DUPLICATE", "CANCELLED", "UNLINKED", "FORBIDDEN", "STALE_SESSION", "NO_SESSION",
    "SESSION_CHANGED", "WRONG_CHAT", "INVALID", "DUPLICATE_REFERENCE", "HELP"].includes(String(row.outcome))) {
    throw new TelegramPersistenceError();
  }
  return row as unknown as UpdateResult;
}
export async function markConfirmation(transactionId: string, sent: boolean): Promise<void> {
  await rpc("telegram_mark_confirmation", { p_transaction_id: transactionId, p_sent: sent });
}
/** Backend only: a future manager transport must supply the demonstration actor. */
export async function setManagerTelegramLink(actorEmployeeId: string, userId: string, employeeId: string): Promise<void> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(actorEmployeeId) || !uuid.test(employeeId)) throw new TelegramPersistenceError("NOT_FOUND");
  await rpc("telegram_set_link", { p_actor_employee_id: actorEmployeeId, p_user_id: telegramId(userId), p_employee_id: employeeId });
}
