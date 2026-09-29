import "server-only";
import { createSupabaseAdminClient } from "../../lib/supabase/server";
import { isUuid, parseTransaction } from "../records/types";
import { createSheetsClient, upsertReference } from "./client";
import { sheetRow } from "./rows";

export type SyncOutcome = "SYNCED" | "FAILED" | "PENDING" | "BUSY" | "FORBIDDEN";
type Receipt = { outcome: string; token?: string; transaction?: unknown };

async function synchronize(transactionId: string, actorId: string | null): Promise<SyncOutcome> {
  let token: string | undefined;
  let revision = 1;
  let writeCompleted = false;
  let client: ReturnType<typeof createSupabaseAdminClient>;
  async function rpc(name: string, args: Record<string, unknown>): Promise<Receipt> {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(error.code === "BF001" ? "FORBIDDEN" : "DATABASE");
    if (!data || typeof data.outcome !== "string") throw new Error("DATABASE");
    return data as Receipt;
  }
  const finish = (outcome: "SUCCESS" | "FAILED" | "PENDING") => rpc("finish_sheet_sync", {
    p_transaction_id: transactionId, p_token: token, p_written_revision: revision, p_outcome: outcome,
  });
  try {
    if (!isUuid(transactionId)) return "FAILED";
    client = createSupabaseAdminClient();
    const begin = await rpc("begin_sheet_sync", { p_transaction_id: transactionId, p_actor_employee_id: actorId });
    if (begin.outcome === "BUSY" || begin.outcome === "SYNCED") return begin.outcome;
    if (begin.outcome !== "STARTED" || !isUuid(begin.token)) throw new Error("DATABASE");
    token = begin.token;
    let tx = parseTransaction(begin.transaction);
    const sheets = createSheetsClient();
    for (let attempt = 0; attempt < 3; attempt++) {
      revision = tx.revision;
      writeCompleted = false;
      const row = sheetRow(tx);
      await upsertReference(sheets, row.tab, row.headers, row.values);
      writeCompleted = true;
      const result = await finish("SUCCESS");
      if (result.outcome === "SYNCED") return "SYNCED";
      if (result.outcome !== "STALE") throw new Error("DATABASE");
      tx = parseTransaction(result.transaction);
    }
    // Bounded work per request. Another business edit remains visibly retryable.
    await finish("PENDING");
    return "PENDING";
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return "FORBIDDEN";
    if (token && !writeCompleted) {
      try { await finish("FAILED"); } catch { return "PENDING"; }
      return "FAILED";
    }
    // A successful write with uncertain DB acknowledgement is never called synced.
    // Keep ownership if acknowledgement failed, protecting against overlapping writers.
    return "PENDING";
  }
}

/** Trusted server post-commit hook; never exported as a browser action. */
export function syncTransactionToSheets(transactionId: string): Promise<SyncOutcome> {
  return synchronize(transactionId, null);
}
/** Browser retry must provide a real actor; SQL rechecks active stored MANAGER. */
export function retrySheetsSync(actorEmployeeId: string, transactionId: string): Promise<SyncOutcome> {
  if (!isUuid(actorEmployeeId)) return Promise.resolve("FORBIDDEN");
  return synchronize(transactionId, actorEmployeeId);
}
