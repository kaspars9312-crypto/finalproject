import "server-only";
import Decimal from "decimal.js";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { isUuid, parseTransaction, type TransactionView } from "../records/types";
import { allocation, euro } from "../sheets/rows";
import { sendMessage } from "./client";
import { telegramId } from "./types";

export type DecisionOutcome = "SENT" | "FAILED" | "NO_RECIPIENT" | "PENDING" | "BUSY" | "NOT_REQUIRED" | "FORBIDDEN";
export const NO_RECIPIENT_TEXT = "No Telegram recipient linked";
export type DecisionRecord = TransactionView & { commission_pool_cents: string | null };

/** Display persisted results only. Commission calculation remains in Block C/D. */
export function decisionText(t: DecisionRecord): string {
  if (t.transaction_type === "SALE" && t.status === "APPROVED") {
    const shares = [
      ["Richard", t.proposed_richard_pct!, t.final_richard_pct!, t.richard_commission_cents!],
      ["Anastasia", t.proposed_anastasia_pct!, t.final_anastasia_pct!, t.anastasia_commission_cents!],
      ["Jean-Claude", t.proposed_jean_claude_pct!, t.final_jean_claude_pct!, t.jean_claude_commission_cents!],
    ];
    const changed = shares.some(([, proposed, final]) => !new Decimal(proposed).eq(final));
    return [`Sale ${t.reference} approved.`, `Sale amount: ${euro(t.amount_cents)}.`,
      `Total commission pool: ${euro(t.commission_pool_cents!)}.`,
      changed ? "MANAGER CHANGED THE SPLIT (proposed → final):" : "Manager changed the split: No. Proposed split approved unchanged.",
      ...shares.map(([name, proposed, final, earned]) =>
        `${name}: ${changed ? `${proposed}% → ` : ""}${final}% = ${euro(earned)}`)].join("\n");
  }
  if (t.transaction_type === "EXPENSE" && t.status === "ALLOCATED" && t.proposed_allocation !== "COMPANY_OVERHEAD") {
    const changed = t.proposed_allocation !== t.final_allocation;
    return [`Expense ${t.reference} allocated.`, `Amount: ${euro(t.amount_cents)}.`, `Description: ${t.description}`,
      changed ? `MANAGER CHANGED ALLOCATION: proposed ${allocation(t.proposed_allocation)} → final ${allocation(t.final_allocation)}.`
        : `Proposed allocation confirmed. Final allocation: ${allocation(t.final_allocation)}.`].join("\n");
  }
  throw new Error("No manager decision to deliver.");
}

/** Same path for automatic delivery and manager retry; never repeats finance. */
export async function deliverDecision(actorEmployeeId: string, transactionId: string): Promise<DecisionOutcome> {
  if (!isUuid(actorEmployeeId)) return "FORBIDDEN";
  if (!isUuid(transactionId)) return "FAILED";
  let token: string | undefined;
  let sent = false;
  let client: ReturnType<typeof createSupabaseAdminClient>;
  async function rpc(name: string, args: Record<string, unknown>) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(error.code === "BG001" ? "FORBIDDEN" : "DATABASE");
    if (!data || typeof data.outcome !== "string") throw new Error("DATABASE");
    return data;
  }
  const finish = (outcome: "SENT" | "FAILED") => rpc("finish_decision_delivery", {
    p_transaction_id: transactionId, p_token: token, p_outcome: outcome,
  });
  try {
    client = createSupabaseAdminClient();
    const claim = await rpc("begin_decision_delivery", { p_actor_employee_id: actorEmployeeId, p_transaction_id: transactionId });
    if (["SENT", "NO_RECIPIENT", "NOT_REQUIRED", "BUSY"].includes(claim.outcome)) return claim.outcome as DecisionOutcome;
    if (claim.outcome !== "STARTED" || !isUuid(claim.token)) throw new Error("DATABASE");
    token = claim.token;
    const t = parseTransaction(claim.transaction);
    if (t.id !== transactionId || typeof claim.target_chat_id !== "string" || telegramId(claim.target_chat_id) === "0") throw new Error("DATABASE");
    const pool = claim.transaction.commission_pool_cents;
    if (t.transaction_type === "SALE" && (typeof pool !== "string" || !/^\d+$/.test(pool))) throw new Error("DATABASE");
    await sendMessage(claim.target_chat_id, decisionText({ ...t, commission_pool_cents: pool }));
    sent = true;
    return (await finish("SENT")).outcome === "SENT" ? "SENT" : "PENDING";
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return "FORBIDDEN";
    if (token && !sent) {
      try { return (await finish("FAILED")).outcome === "FAILED" ? "FAILED" : "PENDING"; }
      catch { return "PENDING"; }
    }
    // Do not downgrade a successful send after an uncertain DB acknowledgement.
    // Retain ownership; an interrupted owner needs operator recovery, not expiry.
    return "PENDING";
  }
}
