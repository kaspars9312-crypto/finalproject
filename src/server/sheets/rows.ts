import "server-only";
import type { TransactionView } from "../records/types";

export const SALES_HEADERS = ["Reference", "Submission time", "Salesperson", "Customer", "Project", "Description", "Amount",
  "Proposed Richard %", "Proposed Anastasia %", "Proposed Jean-Claude %", "Approved Richard %", "Approved Anastasia %",
  "Approved Jean-Claude %", "Richard earned commission", "Anastasia earned commission", "Jean-Claude earned commission", "Status"];
export const EXPENSES_HEADERS = ["Reference", "Submission time", "Reporter", "Description", "Category", "Amount",
  "Proposed allocation", "Final allocation", "Status"];
export const STATUS_LABELS = { PENDING_APPROVAL: "Pending approval", APPROVED: "Approved",
  AWAITING_ALLOCATION: "Awaiting allocation", ALLOCATED: "Allocated" };
export function euro(cents: string): string {
  if (!/^\d+$/.test(cents)) throw new Error("Exact integer cents required.");
  const value = BigInt(cents);
  return `€${value / BigInt(100)}.${(value % BigInt(100)).toString().padStart(2, "0")}`;
}
export function allocation(value: string | null): string {
  return value === "COMPANY_OVERHEAD" ? "Company overhead" : value ?? "";
}
export function sheetRow(t: TransactionView): { tab: "Sales" | "Expenses"; headers: string[]; values: string[] } {
  if (t.transaction_type === "SALE") {
    const approved = t.status === "APPROVED";
    return { tab: "Sales", headers: SALES_HEADERS, values: [t.reference, t.submitted_at, t.submitter_name,
      t.customer!, t.project!, t.description, euro(t.amount_cents),
      t.proposed_richard_pct!, t.proposed_anastasia_pct!, t.proposed_jean_claude_pct!,
      approved ? t.final_richard_pct! : "", approved ? t.final_anastasia_pct! : "", approved ? t.final_jean_claude_pct! : "",
      // Explicit zero follows the authoritative assignment and frozen architecture.
      approved ? euro(t.richard_commission_cents!) : euro("0"),
      approved ? euro(t.anastasia_commission_cents!) : euro("0"),
      approved ? euro(t.jean_claude_commission_cents!) : euro("0"), STATUS_LABELS[t.status]] };
  }
  return { tab: "Expenses", headers: EXPENSES_HEADERS, values: [t.reference, t.submitted_at, t.submitter_name,
    t.description, ({ MATERIALS: "Materials", TRAVEL: "Travel", OTHER: "Other" })[t.expense_category!],
    euro(t.amount_cents), allocation(t.proposed_allocation), t.status === "ALLOCATED" ? allocation(t.final_allocation) : "", STATUS_LABELS[t.status]] };
}
