import "server-only";
import type { Allocation, ExpenseCategory, Project } from "../../domain/types";
import { DomainError } from "../../domain/validation";
import { createWebsiteSale, createWebsiteExpense, correctPendingSale, approveSale, allocateExpense,
  type OperationResult } from "../operations/transactions";
import { readVisibleTransactions } from "../records/read";
import { isUuid } from "../records/types";
import { syncTransactionToSheets } from "../sheets/sync";
import { deliverDecision, NO_RECIPIENT_TEXT } from "../telegram/decisions";
import { setManagerTelegramLink, TelegramPersistenceError } from "../telegram/persistence";
import { euroCents } from "../telegram/wizard";
import { telegramId } from "../telegram/types";

export interface FormResult { ok: boolean; message: string }
class InputError extends Error {}
function field(form: FormData, name: string): string {
  const values = form.getAll(name);
  if (values.length !== 1 || typeof values[0] !== "string") throw new InputError(`Supply one ${name} value.`);
  return values[0];
}
function amount(form: FormData): number {
  try { return Number(euroCents(field(form, "amount"))); }
  catch (error) { throw new InputError(error instanceof Error ? error.message : "Enter a valid euro amount."); }
}
function split(form: FormData) {
  return { RICHARD: field(form, "richard"), ANASTASIA: field(form, "anastasia"), JEAN_CLAUDE: field(form, "jeanClaude") };
}

/** Untrusted FormData is whitelisted; the selected employee's stored role wins. */
export async function executeWebsiteForm(form: FormData): Promise<FormResult> {
  try {
    const employee = field(form, "employee");
    if (!isUuid(employee)) return { ok: false, message: "Select an active employee." };
    const { actor } = await readVisibleTransactions(employee);
    const command = field(form, "command");
    const requiredRole = command === "sale" ? "SALESPERSON" : command === "expense" ? "EXPENSE_REPORTER" : "MANAGER";
    if (actor.role !== requiredRole) return { ok: false, message: "This employee cannot perform this operation." };
    // All RPCs independently recheck active stored role atomically at mutation.
    if (command === "link") {
      let user: string;
      try { user = telegramId(field(form, "telegramUserId").trim()); }
      catch { throw new InputError("Enter a valid positive Telegram user ID."); }
      if (BigInt(user) <= BigInt(0)) throw new InputError("Enter a valid positive Telegram user ID.");
      await setManagerTelegramLink(actor.id, user, field(form, "linkedEmployee"));
      return { ok: true, message: "Telegram employee link saved. Historical submissions keep their identity and destination." };
    }
    if (command === "retryDecision") {
      const outcome = await deliverDecision(actor.id, field(form, "transaction"));
      return { ok: outcome === "SENT", message: outcome === "NO_RECIPIENT" ? NO_RECIPIENT_TEXT
        : `Telegram decision: ${outcome}. The financial decision remains saved.` };
    }
    const actorEmployeeId = actor.id;
    const saleValues = () => ({ customer: field(form, "customer"), project: field(form, "project") as Project,
      description: field(form, "description"), amountCents: amount(form) });
    const decision = () => ({ actorEmployeeId, transactionId: field(form, "transaction"), expectedRevision: Number(field(form, "revision")) });
    let result: OperationResult;
    if (command === "sale") result = await createWebsiteSale({ actorEmployeeId, reference: field(form, "reference"), ...saleValues(), proposedSplit: split(form) });
    else if (command === "expense") result = await createWebsiteExpense({ actorEmployeeId, reference: field(form, "reference"),
      description: field(form, "description"), amountCents: amount(form), category: field(form, "category") as ExpenseCategory,
      proposedAllocation: field(form, "allocation") as Allocation });
    else if (command === "correct") result = await correctPendingSale({ ...decision(), ...saleValues() });
    else if (command === "approveProposed") result = await approveSale(decision());
    else if (command === "approveFinal") result = await approveSale({ ...decision(), finalSplit: split(form) });
    else if (command === "allocate") result = await allocateExpense({ ...decision(), finalAllocation: field(form, "allocation") as Allocation });
    else throw new InputError("Unknown website operation.");
    if (!result.ok) return { ok: false, message: result.error.message };
    const isDecision = ["approveProposed", "approveFinal", "allocate"].includes(command);
    // A successful financial receipt precedes BOTH independent integrations.
    const outcomes = await Promise.allSettled([
      syncTransactionToSheets(result.transaction.id),
      isDecision ? deliverDecision(actor.id, result.transaction.id) : Promise.resolve("NOT_REQUIRED" as const),
    ]);
    const sheets = outcomes[0].status === "fulfilled" ? outcomes[0].value : "PENDING";
    const notification = outcomes[1].status === "fulfilled" ? outcomes[1].value : "PENDING";
    return { ok: true, message: `Saved. Sheets: ${sheets}.` + (isDecision
      ? ` Telegram decision: ${notification === "NO_RECIPIENT" ? `NO_RECIPIENT — ${NO_RECIPIENT_TEXT}` : notification}.` : "") };
  } catch (error) {
    if (error instanceof InputError || error instanceof DomainError || error instanceof TelegramPersistenceError) return { ok: false, message: error.message };
    return { ok: false, message: "The operation could not be confirmed. Reload records before retrying." };
  }
}
