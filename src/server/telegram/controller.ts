import "server-only";
import { sendMessage } from "./client";
import { applyUpdate, markConfirmation, readSession } from "./persistence";
import { prompts, validateAnswer } from "./wizard";
import type { SavedSubmission, TelegramUpdate, UpdateResult } from "./types";

const help = "Use /sale to submit a sale, /expense to submit an expense, or /cancel to cancel the current entry.";
const linkRequired = "Your Telegram account is not linked to an active employee yet. A manager must link it on the website. Use /start first if you have not already done so.";
export function confirmationText(tx: SavedSubmission): string {
  const cents = BigInt(tx.amount_cents);
  const money = `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
  const statuses = { PENDING_APPROVAL: "Pending approval", AWAITING_ALLOCATION: "Awaiting allocation", ALLOCATED: "Allocated" };
  const destination = tx.destination === "COMPANY_OVERHEAD" ? "Company overhead" : tx.destination;
  return `${tx.transaction_type === "SALE" ? "Sale" : "Expense"} ${tx.reference} recorded. Amount: €${money}. ${tx.transaction_type === "SALE" ? "Project" : "Proposed allocation"}: ${destination}. Status: ${statuses[tx.status]}.`;
}
function reply(result: Exclude<UpdateResult, { outcome: "SAVED" }>, validationError?: string): string | null {
  switch (result.outcome) {
    case "DUPLICATE": return null;
    case "START": return result.employee_name ? `Linked as ${result.employee_name} (${result.role}). ${help}` : linkRequired;
    case "PROMPT": return prompts[result.step] ?? "Start again with /sale or /expense.";
    case "CANCELLED": return "The current entry was cancelled.";
    case "UNLINKED": return linkRequired;
    case "FORBIDDEN": return "Your linked employee role cannot use this submission command. Sales require a salesperson; expenses require Kevin (expense reporter).";
    case "STALE_SESSION": return "Your employee link or role changed. The old entry was cancelled. Start again with /sale or /expense.";
    case "NO_SESSION": return "No active entry remains; it may have been cleared after a manager changed your link. Start again with /sale or /expense.";
    case "SESSION_CHANGED": return "The entry changed while this answer was arriving. This answer was not applied. Start again with /sale or /expense.";
    case "WRONG_CHAT": return "Continue the entry in the private chat where you started it, or start a new /sale or /expense here.";
    case "INVALID": return `${validationError ?? "The entry contains invalid or missing values."} Correct your answer, or restart with /sale or /expense to change earlier values.`;
    case "DUPLICATE_REFERENCE": return "That transaction reference is already recorded. Start again with /sale or /expense and use a different reference.";
    case "HELP": return help;
  }
}
export async function processUpdate(update: TelegramUpdate): Promise<void> {
  const { message } = update;
  const commandMatch = /^\/(start|sale|expense|cancel)(?:@[a-zA-Z0-9_]+)?(?:\s|$)/.exec(message.text.trim());
  const command = commandMatch ? commandMatch[1].toUpperCase() : message.text.trim().startsWith("/") ? "HELP" : "ANSWER";
  const session = command === "ANSWER" ? await readSession(message.from.id) : null;
  const answer = session ? validateAnswer(session, message.text) : null;
  const result = await applyUpdate({ updateId: update.update_id, userId: message.from.id, chatId: message.chat.id,
    command, session, value: answer?.value });
  if (result.outcome === "SAVED") {
    let sent = false;
    try { await sendMessage(result.transaction.target_chat_id, confirmationText(result.transaction)); sent = true; }
    catch { /* The saved financial row survives; persist a fixed, token-free error. */ }
    await markConfirmation(result.transaction.id, sent);
  } else {
    const text = reply(result, answer?.error);
    if (text) {
      try { await sendMessage(message.chat.id, text); }
      catch { /* Wizard state remains durable; /start and commands can recover UX. */ }
    }
  }
}
